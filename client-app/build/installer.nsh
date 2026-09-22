!macro customInit
  ; userFLOW and Session Manager are independent applications.
  ; A userFLOW update only closes/replaces userFLOW itself and must never
  ; stop, install, downgrade or upgrade Session Manager.
  nsExec::ExecToLog '"$SYSDIR\taskkill.exe" /F /IM "userFLEX Client.exe"'
  Pop $0
  nsExec::ExecToLog '"$SYSDIR\taskkill.exe" /F /IM "userFLOW.exe"'
  Pop $0
!macroend
