package main

import "testing"

func TestFilterPublicByQueryTagsCategories(t *testing.T) {
	all := []PublicPostItem{
		{Title: "Alpha", Body: "x", AuthorLabel: "GitHub @a", Tags: []string{"Go"}, Categories: []string{}},
		{Title: "Beta", Body: "y", AuthorLabel: "GitHub @b", Tags: []string{"Rust"}, Categories: []string{"技术教程"}},
	}
	filtered := filterPublicByQuery(all, "go")
	if len(filtered) != 1 || filtered[0].Title != "Alpha" {
		t.Fatalf("tag filter: got %+v", filtered)
	}
	filtered2 := filterPublicByQuery(all, "技术")
	if len(filtered2) != 1 || filtered2[0].Title != "Beta" {
		t.Fatalf("category filter: got %+v", filtered2)
	}
	filtered3 := filterPublicByQuery(all, "教程")
	if len(filtered3) != 1 || filtered3[0].Title != "Beta" {
		t.Fatalf("partial category: got %+v", filtered3)
	}
}
