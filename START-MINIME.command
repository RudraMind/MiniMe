#!/bin/zsh
# One-click setup and launch for MiniMe on macOS.
# Double-click this file in Finder. Installs dependencies the first time,
# then starts the app.

cd "$(dirname "$0")" || exit 1

echo
echo "  MiniMe"
echo "  ------"
echo

# A double-clicked .command gets a non-interactive shell, so a Node installed
# via nvm or Homebrew is not on PATH yet. Pull those in before giving up.
if ! command -v node >/dev/null 2>&1; then
  [ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1
fi
if ! command -v node >/dev/null 2>&1; then
  for p in /opt/homebrew/bin /usr/local/bin; do
    [ -x "$p/node" ] && PATH="$p:$PATH" && export PATH
  done
fi

if ! command -v node >/dev/null 2>&1; then
  echo "  Node.js is not installed."
  echo
  echo "  Install it from https://nodejs.org  (pick the LTS version),"
  echo "  then double-click this file again."
  echo
  read -r "?  Press return to close..."
  exit 1
fi

if [ ! -d "node_modules/electron" ]; then
  echo "  First run - installing dependencies. This takes a minute..."
  echo
  # Corporate networks that inspect TLS present their own root CA, which npm's
  # bundled certificate list does not contain. Trusting the system keychain
  # lets Electron's binary download succeed behind such a proxy.
  NODE_OPTIONS=--use-system-ca npm install
  if [ $? -ne 0 ]; then
    echo
    echo "  Install failed. Check your internet connection and try again."
    read -r "?  Press return to close..."
    exit 1
  fi
  echo
fi

echo "  Starting MiniMe. Closing this window will close MiniMe."
echo "  To quit properly, use the menu bar icon > Quit."
echo
npm start
