#!/bin/bash
cd "$(dirname "$0")"
./startup.sh
status=$?
if [[ "$status" -ne 0 && "$status" -ne 130 && "$status" -ne 143 ]]; then
  echo "Startup failed. Read the message above. Press Enter to close."
  read -r
fi
exit "$status"
