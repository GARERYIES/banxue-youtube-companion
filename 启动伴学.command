#!/bin/zsh
cd "${0:A:h}"
node_bin="$(command -v node)"
if [[ -z "$node_bin" ]]; then
  for candidate in /opt/homebrew/bin/node /usr/local/bin/node; do
    if [[ -x "$candidate" ]]; then node_bin="$candidate"; break; fi
  done
fi
if [[ -z "$node_bin" ]]; then
  print '请先安装 Node.js 22 或更新版本，再启动伴学。'
  read '?按回车关闭…'
  exit 1
fi
"$node_bin" start.mjs
