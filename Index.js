const axios = require('axios');
const fs = require('fs');

const ADDRESS_API = "https://sodex.dev/mainnet/chain/user/";
const PNL_API = "https://mainnet-data.sodex.dev/api/v1/perps/pnl/overview?account_id=";
const CONCURRENCY = 10; // Number of simultaneous workers
const START_ID = 1000;

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Helper for API calls with basic retry logic
async function apiGet(url, retries = 2) {
    try {
        return await axios.get(url, { timeout: 10000 });
    } catch (e) {
        if (retries > 0) {
            await sleep(1000);
            return apiGet(url, retries - 1);
        }
        return null;
    }
}

async function main() {
    console.log("📂 Loading existing data...");
    let existingData = { users: [] };
    if (fs.existsSync('sodex_data.json')) {
        try {
            existingData = JSON.parse(fs.readFileSync('sodex_data.json', 'utf8'));
        } catch (e) { console.log("⚠️ Could not parse existing JSON, starting fresh."); }
    }

    // Map existing IDs to addresses so we don't fetch them again
    const addressMap = new Map(existingData.users.map(u => [u.id, u.address]));
    
    console.log("🔍 Finding the latest user ID...");
    let latestId = Math.max(...Array.from(addressMap.keys()), START_ID);
    let checkId = latestId + 1;
    let searching = true;

    // Scan for new users (Step of 10 for speed)
    while (searching) {
        const res = await apiGet(`${ADDRESS_API}${checkId}/address`);
        if (res && res.data?.code === 0) {
            latestId = checkId;
            checkId += 5; 
        } else {
            searching = false;
        }
    }
    
    const totalToFetch = latestId - START_ID + 1;
    console.log(`🚀 Processing IDs ${START_ID} to ${latestId} (${totalToFetch} users)`);

    const queue = Array.from({ length: totalToFetch }, (_, i) => i + START_ID);
    const results = [];

    // Worker function: Processes the queue one by one
    async function worker() {
        while (queue.length > 0) {
            const id = queue.shift();
            try {
                // Get address from Map or API
                let address = addressMap.get(id);
                if (!address) {
                    const addrRes = await apiGet(`${ADDRESS_API}${id}/address`);
                    if (addrRes?.data?.code === 0) address = addrRes.data.data.address;
                }

                if (address) {
                    const pnlRes = await apiGet(`${PNL_API}${id}`);
                    const pnlData = pnlRes?.data?.data || {};
                    results.push({
                        id,
                        address,
                        volume: pnlData.cumulative_quote_volume || "0",
                        pnl: pnlData.cumulative_pnl || "0"
                    });
                }
            } catch (err) {
                console.error(`Error on ID ${id}`);
            }
            if (results.length % 100 === 0) console.log(`Progress: ${results.length}/${totalToFetch}`);
        }
    }

    // Fire up the workers
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));

    const finalJson = {
        updated_at: new Date().toISOString(),
        total_users: results.length,
        users: results.sort((a, b) => a.id - b.id)
    };

    fs.writeFileSync('sodex_data.json', JSON.stringify(finalJson, null, 2));
    console.log(`✅ Success! ${results.length} users saved to sodex_data.json`);
}

main();

