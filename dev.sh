#!/bin/bash
cd "$(dirname "$0")"
npm run dev:api -w backend &
npm run dev:worker -w backend &
npm run dev -w frontend &
wait
