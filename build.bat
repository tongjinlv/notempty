@echo off
chcp 65001 >nul 2>&1
setlocal enabledelayedexpansion

cd /d "%~dp0"

if "%~1"=="" goto :usage

if /i "%~1"=="help" goto :usage
if /i "%~1"=="-h" goto :usage
if /i "%~1"=="--help" goto :usage

if /i "%~1"=="build" (
    echo 正在编译 ^(main.go + vault.go^)...
    go build -o notes.exe .
    if !errorlevel! equ 0 (
        echo 编译成功: %~dp0notes.exe
    ) else (
        echo 编译失败!
        exit /b 1
    )
    goto :eof
)

if /i "%~1"=="run" (
    echo 正在运行 ^(go run .，与 main.go 中 flag 一致，可跟 -addr、-data 等^)...
    for /f "tokens=1*" %%A in ("%*") do go run . %%B
    goto :eof
)

echo 无效的参数: %~1
:usage
echo.
echo 用法: %~nx0 ^<命令^> [运行时的额外参数...]
echo.
echo   build     编译当前目录下整个 main 包，输出 notes.exe
echo   run       开发运行 ^(go run .^)，可附加程序参数，例如:
echo             %~nx0 run -addr=0.0.0.0:8787
echo             %~nx0 run -data=E:\path\to\notes-vault
echo   help      显示本说明
echo.
if not "%~1"=="" if /i not "%~1"=="help" if /i not "%~1"=="-h" if /i not "%~1"=="--help" exit /b 1
