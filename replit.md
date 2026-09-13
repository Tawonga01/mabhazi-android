# Workspace

## Overview

BusHop — a community-driven intercity bus itinerary mobile app built with Expo + Express. Users can search for bus routes, view departure schedules, contribute routes and stops, rate journeys, report issues, and review route-association proposals linked to their account.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod, `drizzle-zod`
- **Auth**: Replit Auth (OIDC/PKCE) — mobile flow via `expo-auth-session`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)
- **Mobile**: Expo SDK 54 (React Native)

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-server run typecheck` — typecheck the API server
- `pnpm --filter @workspace/mobile run typecheck` — typecheck the mobile app
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)

## App Features

### Search (Tab 1)
- Departure city, arrival city, date inputs
- Fuzzy city matching (case-insensitive ILIKE)
- Journey cards showing: bus company, departure/arrival times, pickup/drop-off points, price, contributor name, confidence/status, ratings, and intermediate stops
- Journey details with community reports, price insights, punctuality information, and correction/claim actions

### Contribute (Tab 2)
- Requires authentication via Replit Auth
- Form: from/to city, departure/arrival times, scheduled operating days, bus company, pickup point, drop-off point, price, and optional intermediate stops
- Contributor's display name auto-assigned from their Replit account

### Departures (Tab 3)
- Shows upcoming departures from a selected city
- Supports destination navigation back into search

### Profile (Tab 4)
- Shows logged-in user's name, email, avatar
- Allows display-name updates with a cooldown
- Shows pending route-association proposals for contributed journeys
- Login/logout controls

## Database Schema

- `users` — Replit Auth users (id, email, firstName, lastName, profileImageUrl)
- `sessions` — Auth sessions (sid, sess, expire)
- `cities` — searchable city names used by route and departure pickers
- `bus_companies` — active/inactive bus operators
- `journeys` — bus routes (id, fromCity, toCity, departureTime, arrivalTime, scheduledDays, busCompany, pickupPoint, dropoffPoint, price, contributedBy, contributorName, dataStatus, confidenceScore, confirmationCount, lastConfirmedAt, createdAt)
- `journey_stops` — intermediate stops and their arrival/departure times
- `journey_contributions` — original contributor payloads
- `journey_ratings` — per-user journey scores
- `journey_reports` — community comments, treatment, breakdown, delay, and price reports
- `journey_claims` — journey data claims and confirmations
- `proposed_associations` — proposed relationships between related journeys
- `search_events` — anonymous and authenticated search analytics

## API Endpoints

- `GET /api/healthz` — service health
- `GET /api/auth/user` — get current user
- `GET /api/login` and `GET /api/callback` — Replit Auth browser login flow
- `GET /api/logout` — browser logout
- `POST /api/mobile-auth/token-exchange` — mobile OIDC token exchange
- `POST /api/mobile-auth/session-to-token` — exchange a browser session for a mobile token
- `POST /api/mobile-auth/logout` — mobile logout
- `PATCH /api/users/display-name` — update the authenticated user's display name
- `GET /api/journeys?fromCity=&toCity=&day=` — search journeys
- `POST /api/journeys` — create journey (auth required)
- `GET /api/journeys/:id/details` — get journey reports and community details
- `POST /api/journeys/:id/confirm` — confirm a journey (auth required)
- `POST /api/journeys/:id/claim` — submit a journey claim (auth required)
- `POST /api/journeys/:id/reports` — submit a journey report (auth required)
- `POST /api/journeys/:id/rating` — rate a journey (auth required)
- `GET /api/cities` — list searchable cities
- `GET /api/bus-companies` — list active bus companies
- `GET /api/associations/pending` — list pending proposals for the authenticated user
- `POST /api/associations/:id/confirm` — confirm a route association
- `POST /api/associations/:id/reject` — reject a route association
- `POST /api/associations/:id/reverse` — reverse a confirmed association
- `GET /api/admin` and `/api/admin/*` — admin dashboard and management endpoints

The admin dashboard requires the configured `ADMIN_SECRET`.

## Colors

- Primary: `#1E3A5F` (deep navy)
- Accent: `#F97316` (orange)
- Background: `#F0F4F8`
