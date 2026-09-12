!macro customInit
  ; Close stale userFLOW/userFLEX processes left by a previous failed launch
  ; so upgrades can replace the executable without asking the user to do it manually.
  nsExec::ExecToLog '"$SYSDIR\taskkill.exe" /F /T /IM "userFLEX Client.exe"'
  Pop $0
  nsExec::ExecToLog '"$SYSDIR\taskkill.exe" /F /T /IM "userFLOW.exe"'
  Pop $0
  Sleep 800
!macroend
