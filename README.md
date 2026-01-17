
<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Binni Trading Assistant

An AI-powered crypto trading assistant that uses intelligent agents to analyze market data, suggest trades, and manage a trading journal for spot, futures, and paper trading.

## Run Locally

**Prerequisites:**  Node.js 20+

1. Install dependencies:
   `npm install`
2. Set the `VITE_BINANCE_API_KEY` and `VITE_BINANCE_API_SECRET` in `.env.local`.
3. Run the app:
   `npm run dev`

---

## AWS Amplify Deployment (Fix for 404 Errors)

If you deploy this to AWS Amplify, you must configure **Rewrites and Redirects** to allow the application to talk to the Binance API. Without this, you will see `404` or `Proxy Configuration Error`.

### 1. Environment Variables
In the Amplify Console, go to **App settings > Environment variables** and add:
- `VITE_BINANCE_API_KEY`
- `VITE_BINANCE_API_SECRET`
- `VITE_TELEGRAM_BOT_TOKEN` (Optional)
- `VITE_TELEGRAM_CHAT_ID` (Optional)

### 2. Rewrites and Redirects (CRITICAL)
Go to **App settings > Rewrites and redirects**. Click **Edit**, choose **JSON editor**, and paste this configuration:

```json
[
    {
        "source": "/proxy-spot/<*>",
        "target": "https://api.binance.com/<*>",
        "status": "200",
        "condition": null
    },
    {
        "source": "/proxy-futures/<*>",
        "target": "https://fapi.binance.com/<*>",
        "status": "200",
        "condition": null
    },
    {
        "source": "/proxy-spot-ws/<*>",
        "target": "wss://stream.binance.com/<*>",
        "status": "200",
        "condition": null
    },
    {
        "source": "/proxy-futures-ws/<*>",
        "target": "wss://fstream.binance.com/<*>",
        "status": "200",
        "condition": null
    },
    {
        "source": "</^[^.]+$|\\.(?!(css|gif|ico|jpg|js|png|txt|svg|woff|woff2|ttf|map|json)$)([^.]+$)/>",
        "target": "/index.html",
        "status": "200",
        "condition": null
    }
]
```

**Explanation:**
1.  **Proxies**: Redirects requests starting with `/proxy-spot` to Binance API, avoiding CORS issues.
2.  **SPA Fallback**: The last rule ensures React routing works when you refresh the page.
