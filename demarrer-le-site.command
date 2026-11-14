#!/bin/sh
# Double-cliquez ce fichier dans le Finder pour lancer le site hors de Claude :
# l'API (http://localhost:3410) et le site (http://localhost:4300) demarrent ensemble
# et restent ouverts tant que cette fenetre de Terminal l'est. Ctrl+C les arrete.
# Node est installe dans ~/.local/node, hors du PATH habituel : ce script l'ajoute.
cd "$(dirname "$0")" || exit 1
PATH="$HOME/.local/node/bin:$PATH"
export PATH
if ! command -v node >/dev/null 2>&1; then
  echo "Node est introuvable (attendu dans ~/.local/node/bin)."
  exit 1
fi
echo "Site : http://localhost:4300   (Ctrl+C pour arreter)"
exec npm start
