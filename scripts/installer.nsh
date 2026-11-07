; 安装包内的自启接线：安装完成即注册「登录后后台启动服务端」计划任务，卸载时清理。
; 安装器以管理员运行（nsis.perMachine=true），因此脚本可以顺带放行 TCP 27310。

!macro customInstall
  DetailPrint "注册局域网象棋服务端自启…"
  nsExec::ExecToLog 'powershell -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\resources\install-autostart.ps1" -ExePath "$INSTDIR\LanChess.exe"'
!macroend

!macro customUnInstall
  DetailPrint "移除局域网象棋服务端自启…"
  nsExec::ExecToLog 'powershell -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\resources\uninstall-autostart.ps1"'
!macroend
