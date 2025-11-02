#!/bin/sh
rm -f *.vsix
vsce package
code --install-extension *.vsix