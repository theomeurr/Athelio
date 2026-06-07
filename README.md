# Athelio

**Athelio — Suis ton évolution, domine ton sport.**

Compagnon de performance personnelle pour les sportifs qui ne font pas les choses à moitié. Athelio centralise tout ce qui compte : badminton, course à pied, musculation, poids, mensurations, objectifs et récupération — dans un tableau de bord simple, visuel et toujours motivant.

## Fonctionnalités

### 🏸 Badminton
- Suivi des matchs (score, adversaire, victoire/défaite, notes)
- Statistiques par type de jeu (simple, double, mixte)
- Suivi des tournois et interclubs

### 📈 Progression
- Évolution du poids
- Suivi des sorties course à pied (distance, durée, allure)
- Historique des séances de musculation et progression des charges
- Mensurations (taille, bras, cuisses, poitrine)
- Photos avant / après

### 🎯 Objectifs
- Objectifs datés avec barre de progression
- Validation et historique des objectifs atteints

### 🌙 Récupération
- Journal quotidien : sommeil, fatigue, douleurs, mobilité
- Graphique d'évolution sur la durée

## Sports suivis
Badminton · Course à pied · Musculation

## Lancer l'app

Pas de build, pas de dépendance à installer.

```bash
# Option 1 : ouvrir directement
open index.html

# Option 2 : serveur local
python3 -m http.server 8000
# puis http://localhost:8000
```

## Stack

- HTML, CSS, JavaScript (vanilla)
- [Chart.js](https://www.chartjs.org/) via CDN pour les graphiques
- `localStorage` pour la persistance — toutes tes données restent sur ton appareil
- Import / export JSON pour sauvegarde et portabilité

## Données

Au premier lancement, l'app charge un jeu d'exemple pour montrer l'interface. Utilise le bouton **Réinitialiser** dans la barre latérale pour repartir de zéro (ou exporte d'abord pour ne rien perdre).
