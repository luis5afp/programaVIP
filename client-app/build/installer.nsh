!macro customInit
  ; The installer is a separate process. Close the old userFLOW executable
  ; before replacing application files, so Windows never has to overwrite the
  ; running version in place.
  nsExec::ExecToLog '"$SYSDIR\taskkill.exe" /F /IM "userFLEX Client.exe"'
  Pop $0
  nsExec::ExecToLog '"$SYSDIR\taskkill.exe" /F /IM "userFLOW.exe"'
  Pop $0

  ; Session Manager is now a bundled userFLOW component. Close an older copy
  ; before silently upgrading it so the embedded installer can replace files
  ; and refresh the userflex-session:// protocol registration without prompts.
  nsExec::ExecToLog '"$SYSDIR\taskkill.exe" /F /IM "userFLEX Session Manager.exe"'
  Pop $0
  Sleep 800
!macroend

!macro customInstall
  ; Every userFLOW install/update carries the matching Session Manager setup.
  ; Run it silently so customers never need to download or install the helper
  ; separately. Session Manager itself has runAfterFinish=false, so it will not
  ; open during a normal userFLOW update.
  DetailPrint "Instalando/actualizando userFLEX Session Manager..."
  IfFileExists "$INSTDIR\resources\session-manager\userFLEX-Session-Manager-Setup.exe" 0 session_manager_missing

  ClearErrors
  ExecWait '"$INSTDIR\resources\session-manager\userFLEX-Session-Manager-Setup.exe" /S' $0
  IfErrors session_manager_failed
  IntCmp $0 0 session_manager_done session_manager_failed session_manager_failed

session_manager_missing:
  DetailPrint "No se encontró el instalador integrado de userFLEX Session Manager."
  Goto session_manager_done

session_manager_failed:
  DetailPrint "userFLEX Session Manager no pudo instalarse automáticamente (código $0)."

session_manager_done:
!macroend
