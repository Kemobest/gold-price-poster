name: Post Gold Price to Facebook

on:
  schedule:
    - cron: '0 1,3,5,7,9,11,13 * * *'
  workflow_dispatch:

jobs:
  post-gold-price:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install dependencies
        run: npm install

      - name: Install Playwright browsers
        run: npx playwright install chromium --with-deps

      - name: Run gold price poster
        env:
          FB_PAGE_ID: ${{ secrets.FB_PAGE_ID }}
          FB_ACCESS_TOKEN: ${{ secrets.FB_ACCESS_TOKEN }}
        run: node index.js

      - name: Commit screenshot and last price
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add screenshot.png last_price.json
          git diff --staged --quiet || git commit -m "Update screenshot and last price"
          git push
