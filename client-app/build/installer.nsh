!macro customInit
  ; The installer is a separate process. Close the old userFLOW executable
  ; before replacing application files, so Windows never has to overwrite the
  ; running version in place.
  nsExec::ExecToLog '"$SYSDIR\taskkill.exe" /F /IM "userFLEX Client.exe"'
  Pop $0
  nsExec::ExecToLog '"$SYSDIR\taskkill.exe" /F /IM "userFLOW.exe"'
  Pop $0
  Sleep 800
!macroend
