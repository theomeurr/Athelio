# Athelio

**Athelio — Suis ton évolution, domine ton sport.**

Compagnon de performance personnelle pour les sportifs qui ne font pas les choses à moitié. Athelio centralise tout ce qui compte : badminton, course à pied, musculation, poids, mensurations, objectifs et récupération — dans un tableau de bord simple, visuel et toujours motivant.

## Fonctionnalités

Chaque domaine a son propre module dans la barre latérale.

### 🏸 Badminton
- Suivi des matchs (score, adversaire, victoire/défaite)
- Pour chaque match : ce que j'ai bien fait, ce que j'ai mal fait, et les points à travailler
- Statistiques par type de jeu (simple, double, mixte)
- Suivi des tournois et interclubs

### 🏃 Course à pied
- Suivi des sorties (distance, durée, allure automatique)

### 🏋️ Musculation
- Historique des séances et progression des charges par exercice

### ⚖️ Poids
- Évolution du poids de forme

### 📏 Mensurations
- Poitrine, bras, taille, cuisse — avec un schéma du corps humain indiquant où mesurer
- Graphique d'évolution

### 📷 Photos
- Avant / après pour documenter la transformation

### 🎯 Objectifs
- Objectifs datés avec barre de progression
- Validation et historique des objectifs atteints

### 🌙 Récupération
- Journal de fatigue et de douleurs avec graphique d'évolution

### 🎥 Vidéos
- Vidéos datées (lien YouTube / Vimeo / Drive ou fichier court) + notes
- Visionne facilement ta progression technique dans le temps

## Sports suivis
Badminton · Course à pied · Musculation

## Lancer l'app dans le navigateur

Pas de build nécessaire pour la version web.

```bash
# Option 1 : ouvrir directement
open www/index.html

# Option 2 : serveur local (recommandé pour les Service Workers / PWA)
npm install        # première fois
npm run serve
# puis http://localhost:8000
```

## Installer comme une vraie app (Capacitor)

Le projet est packagé avec [Capacitor](https://capacitorjs.com/) : ton code web reste la
source de vérité, et il est enrobé dans un projet Xcode (iOS) et Android Studio (Android).

### Pré-requis
- Node.js 18+
- macOS + Xcode + CocoaPods (`sudo gem install cocoapods`) pour iOS
- Android Studio pour Android
- Mode développeur activé sur l'iPhone (Réglages → Confidentialité → Mode développeur)

### Première installation

```bash
npm install                # installe Capacitor et ses plugins
npx cap sync               # copie le web dans ios/ et android/
```

### Pousser une mise à jour sur ton téléphone

À chaque fois que tu modifies un fichier dans `www/` :

```bash
npx cap sync               # synchronise les changements
npx cap open ios           # ouvre Xcode  →  Run (▶︎) sur ton iPhone branché
# ou
npx cap open android       # ouvre Android Studio  →  Run sur ton Android
```

Avec un Apple ID gratuit, la signature iOS dure 7 jours. Avec un compte Apple Developer
(99 €/an), elle dure 1 an. Sur Android, aucun store ni compte n'est requis pour sideloader.

## Stack

- HTML, CSS, JavaScript (vanilla)
- [Chart.js](https://www.chartjs.org/) via CDN pour les graphiques
- `localStorage` pour la persistance — toutes tes données restent sur ton appareil
- [Capacitor](https://capacitorjs.com/) pour l'empaquetage en app native (iOS + Android)
- Import / export JSON pour sauvegarde et portabilité

## Structure

```
www/              ← code de l'app (HTML / CSS / JS, icônes, manifest)
ios/              ← projet Xcode généré par Capacitor (ouvrir App.xcworkspace)
android/          ← projet Android Studio généré par Capacitor
capacitor.config  ← config Capacitor (nom, splash, status bar…)
```

## Données

Au premier lancement, l'app charge un jeu d'exemple pour montrer l'interface. Utilise le bouton **Réinitialiser** dans la barre latérale pour repartir de zéro (ou exporte d'abord pour ne rien perdre).
