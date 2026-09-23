!macro customInit
  ; A previous Session Manager can keep the single-instance lock and continue
  ; receiving userflex-session:// links even after a newer installer is copied.
  ; Close the old process before replacing files/protocol registration.
  nsExec::ExecToLog 'taskkill.exe /F /T /IM "userFLEX Session Manager.exe"'
  Sleep 900
!macroend
