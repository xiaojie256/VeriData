@echo off
chcp 65001
cls
echo =========================================
echo     鉴真数据系统 - 启动脚本
echo =========================================
echo.

REM 检查Docker是否运行
docker info >nul 2>&1
if errorlevel 1 (
    echo [错误] Docker 未运行，请先启动 Docker Desktop
    pause
    exit /b 1
)

echo [1/4] 正在构建并启动服务...
docker-compose up -d --build

if errorlevel 1 (
    echo [错误] 服务启动失败
    pause
    exit /b 1
)

echo [2/4] 等待数据库初始化 (约30秒)...
timeout /t 30 /nobreak >nul

echo [3/4] 检查服务状态...
docker-compose ps

echo [4/4] 启动完成！
echo.
echo =========================================
echo  访问地址:
echo    前端: http://localhost
echo    后端API: http://localhost:3000
echo    AI服务: http://localhost:5000
echo =========================================
echo.
echo 常用命令:
echo   查看日志: docker-compose logs -f
echo   停止服务: docker-compose down
echo   重启服务: docker-compose restart
echo.
pause
