# Apify Actors Workspace

## Description
This repository serves as a monorepo for all custom Apify Actors developed for the Nau ecosystem and beyond. It is designed to manage multiple independently deployable actors within a single version-controlled environment.

## Stack
- Node.js (>=20.0.0)
- TypeScript
- Apify SDK
- Crawlee (CheerioCrawler, PlaywrightCrawler)

## Quick Start
To run a specific actor locally:
```bash
cd actors/<actor-name>
npm install
npm start
```

## Architecture
- `actors/`: Contains all individual actor projects.
- `actors/nau-ig-actor`: High-efficiency Instagram scraper designed to replace `apify/instagram-scraper`. Credit-optimized utilizing GraphQL-first scraping.
- `.agent/`: Internal system plans, phase documents, and agent orchestration states (Ignored in Git).
