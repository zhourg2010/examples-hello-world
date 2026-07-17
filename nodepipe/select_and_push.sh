#!/bin/bash
# subs-check callback target. Loads env secrets and runs the picker/pusher.
source ~/nodepipe/env
export PUSH_URL PUSH_KEY PICK_VLESS PICK_OTHER MIN_KEEP
export SUBS_OUTPUT="$HOME/nodepipe/bin/output/all.yaml"
/opt/local/bin/python3.12 "$HOME/nodepipe/select_and_push.py" >> "$HOME/nodepipe/logs/push.log" 2>&1
