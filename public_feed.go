package main

import (
	"io/fs"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

// PublicPostItem 公共主页一条（无需登录）。
type PublicPostItem struct {
	Provider    string `json:"provider"`
	Login       string `json:"login"`
	AuthorLabel string `json:"authorLabel"`
	ID          string `json:"id"`
	Title       string `json:"title"`
	Body        string `json:"body"`
	Dir         string `json:"dir"`
	UpdatedAt   int64  `json:"updatedAt"`
	DetailURL   string `json:"detailUrl"`
}

var imgMdRE = regexp.MustCompile(`!\[([^\]]*)\]\(([^)]+)\)`)

func computeAuthorLabel(provider, login string) string {
	login = strings.TrimSpace(login)
	p := strings.TrimSpace(strings.ToLower(provider))
	pLabel := "GitHub"
	if p == "gitee" {
		pLabel = "Gitee"
	}
	return pLabel + " @" + login
}

func publicAssetPathURL(provider, login, rest string) string {
	rest = strings.TrimPrefix(strings.TrimSpace(rest), "/")
	return "/api/public/asset/" + url.PathEscape(provider) + "/" + url.PathEscape(login) + "/" + rest
}

func rewritePublicMarkdownImages(body, provider, login, dirRel string) string {
	return imgMdRE.ReplaceAllStringFunc(body, func(m string) string {
		sm := imgMdRE.FindStringSubmatch(m)
		if len(sm) < 3 {
			return m
		}
		alt, raw := sm[1], strings.TrimSpace(sm[2])
		if strings.HasPrefix(raw, "http://") || strings.HasPrefix(raw, "https://") {
			return m
		}
		if strings.HasPrefix(raw, "/api/public/") {
			return m
		}
		if strings.HasPrefix(raw, "/api/vault/") {
			rest := strings.TrimPrefix(raw, "/api/vault/")
			rest = strings.TrimPrefix(rest, "/")
			return "![" + alt + "](" + publicAssetPathURL(provider, login, rest) + ")"
		}
		rel := strings.TrimPrefix(strings.TrimPrefix(raw, "./"), "/")
		if rel == "" || strings.Contains(rel, "..") {
			return m
		}
		return "![" + alt + "](" + publicAssetPathURL(provider, login, dirRel+"/"+rel) + ")"
	})
}

// parseUsersDirNotePath 解析 users 目录下相对路径（不含 note.md），得到 provider、磁盘上的 login 目录名、笔记四级目录。
func parseUsersDirNotePath(dirRel string) (provider, login string, noteParts []string, ok bool) {
	dirRel = filepath.ToSlash(dirRel)
	parts := strings.Split(dirRel, "/")
	if len(parts) >= 6 && (parts[0] == "github" || parts[0] == "gitee") {
		noteParts = parts[2:6]
		if !isNoteLayoutDir(noteParts) {
			return "", "", nil, false
		}
		return parts[0], parts[1], noteParts, true
	}
	if len(parts) == 5 {
		noteParts = parts[1:5]
		if !isNoteLayoutDir(noteParts) {
			return "", "", nil, false
		}
		return "github", parts[0], noteParts, true
	}
	return "", "", nil, false
}

// collectPublicPosts 扫描 vaultBase/users 下所有已勾选公开的笔记。
func collectPublicPosts(vaultBase string) ([]PublicPostItem, error) {
	usersDir := filepath.Join(vaultBase, "users")
	st, err := os.Stat(usersDir)
	if err != nil || !st.IsDir() {
		return []PublicPostItem{}, nil
	}
	out := make([]PublicPostItem, 0)
	err = filepath.WalkDir(usersDir, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() || filepath.Base(path) != "note.md" {
			return nil
		}
		parent, e := filepath.Rel(usersDir, filepath.Dir(path))
		if e != nil {
			return nil
		}
		provider, login, noteParts, ok := parseUsersDirNotePath(parent)
		if !ok {
			return nil
		}
		dirRel := strings.Join(noteParts, "/")
		raw, e := os.ReadFile(path)
		if e != nil {
			return nil
		}
		info, _ := d.Info()
		mt := time.Now()
		if info != nil {
			mt = info.ModTime()
		}
		note, e := parseNoteMD(raw, noteParts[3], mt)
		if e != nil || !note.Public {
			return nil
		}
		body := rewritePublicMarkdownImages(note.Body, provider, login, dirRel)
		detail := "/public/post/" + provider + "/" + login + "/" + dirRel
		out = append(out, PublicPostItem{
			Provider:    provider,
			Login:       login,
			AuthorLabel: computeAuthorLabel(provider, login),
			ID:          note.ID,
			Title:       note.Title,
			Body:        body,
			Dir:         dirRel,
			UpdatedAt:   note.UpdatedAt,
			DetailURL:   detail,
		})
		return nil
	})
	if err != nil {
		return nil, err
	}
	sort.Slice(out, func(i, j int) bool {
		return out[i].UpdatedAt > out[j].UpdatedAt
	})
	return out, nil
}

func isPublicImageExt(name string) bool {
	switch strings.ToLower(filepath.Ext(name)) {
	case ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg":
		return true
	default:
		return false
	}
}

func registerPublicAPI(r *gin.Engine, vaultBase string) {
	r.GET("/api/public/posts", func(c *gin.Context) {
		items, err := collectPublicPosts(vaultBase)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		if items == nil {
			items = []PublicPostItem{}
		}
		c.JSON(http.StatusOK, items)
	})

	r.GET("/api/public/asset/:provider/:login/*filepath", func(c *gin.Context) {
		provider := strings.TrimSpace(strings.ToLower(c.Param("provider")))
		if provider != "github" && provider != "gitee" {
			c.Status(http.StatusNotFound)
			return
		}
		login := strings.TrimSpace(c.Param("login"))
		if login == "" || strings.Contains(login, "..") {
			c.Status(http.StatusNotFound)
			return
		}
		fp := strings.TrimPrefix(c.Param("filepath"), "/")
		fp = filepath.ToSlash(filepath.Clean(fp))
		if fp == "." || fp == "" || strings.HasPrefix(fp, "..") || strings.Contains(fp, "..") {
			c.Status(http.StatusNotFound)
			return
		}
		if !isPublicImageExt(fp) {
			c.Status(http.StatusNotFound)
			return
		}
		parts := strings.Split(fp, "/")
		if len(parts) < 4 {
			c.Status(http.StatusNotFound)
			return
		}
		if !isNoteLayoutDir(parts[:4]) {
			c.Status(http.StatusNotFound)
			return
		}
		noteDir := strings.Join(parts[:4], "/")
		notePath := filepath.Join(vaultBase, "users", provider, login, filepath.FromSlash(noteDir), "note.md")
		raw, err := os.ReadFile(notePath)
		if err != nil {
			c.Status(http.StatusNotFound)
			return
		}
		info, err := os.Stat(notePath)
		if err != nil {
			c.Status(http.StatusNotFound)
			return
		}
		note, err := parseNoteMD(raw, parts[3], info.ModTime())
		if err != nil || !note.Public {
			c.Status(http.StatusNotFound)
			return
		}
		abs := filepath.Join(vaultBase, "users", provider, login, filepath.FromSlash(fp))
		absClean, err := filepath.Abs(abs)
		if err != nil {
			c.Status(http.StatusNotFound)
			return
		}
		baseDir := filepath.Join(vaultBase, "users", provider, login)
		baseAbs, err := filepath.Abs(baseDir)
		if err != nil {
			c.Status(http.StatusNotFound)
			return
		}
		sep := string(os.PathSeparator)
		if absClean != baseAbs && !strings.HasPrefix(absClean+sep, baseAbs+sep) {
			c.Status(http.StatusNotFound)
			return
		}
		st, err := os.Stat(absClean)
		if err != nil || st.IsDir() {
			c.Status(http.StatusNotFound)
			return
		}
		data, err := os.ReadFile(absClean)
		if err != nil {
			c.Status(http.StatusNotFound)
			return
		}
		ct, _, ok := detectImageType(data)
		if !ok {
			ct = http.DetectContentType(data)
		}
		c.Header("Cache-Control", "public, max-age=3600")
		c.Data(http.StatusOK, ct, data)
	})
}

func servePublicPage(webRoot fs.FS) gin.HandlerFunc {
	return func(c *gin.Context) {
		b, err := fs.ReadFile(webRoot, "public.html")
		if err != nil {
			c.String(http.StatusInternalServerError, "无法读取页面")
			return
		}
		c.Data(http.StatusOK, "text/html; charset=utf-8", b)
	}
}

func registerPublicWeb(r *gin.Engine, webRoot fs.FS) {
	h := servePublicPage(webRoot)
	r.GET("/public", h)
	r.GET("/public/", h)
	r.GET("/public/post/*rest", h)
	r.GET("/public.js", func(c *gin.Context) {
		b, err := fs.ReadFile(webRoot, "public.js")
		if err != nil {
			c.Status(http.StatusNotFound)
			return
		}
		c.Data(http.StatusOK, "application/javascript; charset=utf-8", b)
	})
}
