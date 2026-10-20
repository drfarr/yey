# nap

**Paste anything. Find out what you could have slept through.**

nap reads the email, the 47-reply Slack thread, the "quick sync" notes, the terms of service, and gives you back:

- a **nap score** (0 to 100): how much of it was filler
- a one-line **verdict** you'll want to screenshot
- the **tl;dr** in one sentence
- up to three **need to know** bullets
- the single thing you have to **do**
- a share link with proper OG tags, so the card looks good when posted

Built on Claude (`claude-opus-5-5`) with structured outputs, so the response is always the same shape.

## Run it

```bash
cd nap
npm install
export ANTHROPIC_API_KEY=sk-ant-...   # or `ant auth login`
npm run dev                            # http://localhost:3000
```

Pipe things at it from the terminal:

```bash
pbpaste | npm run nap
npm run nap -- that-email.txt
npm run nap -- that-email.txt --json
```

## API

```
POST /api/nap        {"text": "..."}   ->  { id, url, tldr, needToKnow, action, napScore, verdict, stats, share }
GET  /api/nap/:id                      ->  same, by id
GET  /n/:id                            ->  shareable HTML card with og: tags
GET  /healthz
```

Limits: 40 to 60,000 characters per nap, 20 naps per minute per IP. Results live in memory for share links (last 1,000) and nothing else is stored.

## Tests

```bash
npm test          # no API key needed, the model is mocked
npm run typecheck
```

## Why it spreads

The output is the marketing. Every nap ends in a number and a one-liner that are more fun to post than the original text was to read, and the share page sends the next person back to paste their own.

## Deploy

It is a single Node process with no database. Any host that runs `npm start` with `ANTHROPIC_API_KEY` and `PORT` set will do. Put it behind a proxy that sets `x-forwarded-for` and `x-forwarded-proto` so rate limits and share URLs are right.
