#!/bin/sh
rm -f *.vsix
vsce package
code --force  --install-extension *.vsix