console.log('Content script v8 loaded - Data row verification added');

// Check if the page is ready (button available AND data loaded)
function checkIfReady() {
    const menuButton = document.querySelector('#grid-toolbar-ellipsis-menu-button');
    
    // Check for data rows - look for role="row" elements (common in data grids)
    const dataRows = document.querySelectorAll('[role="row"]');
    
    // We need the button AND at least some data rows (more than just headers)
    // Typically there's 1 header row, so we want at least 2-3 rows total
    const hasData = dataRows.length > 2;
    
    const isReady = menuButton !== null && hasData;
    
    if (menuButton && !hasData) {
        console.log('Button found but waiting for data to load... (rows:', dataRows.length, ')');
    } else if (isReady) {
        console.log('✓ Button found AND data loaded (rows:', dataRows.length, ')');
    } else {
        console.log('✗ Button not found yet');
    }
    
    return isReady;
}

// Poll for "Load all" button to appear
function pollForLoadAllButton(csvType, attemptNumber = 0, maxAttempts = 100) {
    const checkIntervalMs = 3000; // Check every 3 seconds (100 attempts = 5 minutes)
    
    if (attemptNumber >= maxAttempts) {
        console.error(`✗ Timeout waiting for "Load all" button after ${maxAttempts * checkIntervalMs / 1000} seconds`);
        chrome.runtime.sendMessage({
            action: 'exportFailed',
            csvType: csvType,
            error: 'Timeout waiting for "Load all" popup'
        });
        return;
    }
    
    console.log(`Polling for "Load all" button, attempt ${attemptNumber + 1}/${maxAttempts}...`);
    
    // Look for the "Load all" button
    const loadAllButton = Array.from(document.querySelectorAll('button'))
        .find(btn => btn.textContent.trim() === 'Load all');
    
    if (loadAllButton) {
        console.log('✓ Found "Load all" button! Clicking...');
        loadAllButton.click();
        console.log('✓ "Load all" clicked - now waiting ~15-20 minutes for CSV to export...');
        
        chrome.runtime.sendMessage({
            action: 'loadAllClicked',
            csvType: csvType
        });
        
        // Note: The download will be detected by background.js's download listener
        // No need to do anything else here - just let it export
    } else {
        // Not found yet, try again
        setTimeout(() => {
            pollForLoadAllButton(csvType, attemptNumber + 1, maxAttempts);
        }, checkIntervalMs);
    }
}

// Function to trigger CSV export
function triggerExport(csvType = 'manual') {
    console.log('Export CSV triggered, type:', csvType);
    
    const menuButton = document.querySelector('#grid-toolbar-ellipsis-menu-button');
    
    if (!menuButton) {
        console.error('✗ Menu button not found');
        chrome.runtime.sendMessage({
            action: 'exportFailed',
            csvType: csvType,
            error: 'Menu button not found'
        });
        return false;
    }
    
    console.log('✓ Found menu button, clicking...');
    menuButton.click();
    
    // Wait for menu to appear, then click "Export CSV"
    setTimeout(() => {
        const exportButton = Array.from(document.querySelectorAll('button, [role="menuitem"], li'))
            .find(btn => btn.textContent.includes('Export CSV'));
        
        if (exportButton) {
            console.log('✓ Found Export CSV button, clicking...');
            exportButton.click();
            
            chrome.runtime.sendMessage({
                action: 'exportTriggered',
                csvType: csvType
            });
            
            console.log('✓ Export CSV clicked successfully!');
            
            // SPECIAL HANDLING FOR LINE ITEMS
            if (csvType === 'lineitems') {
                console.log('Line Items detected - starting "Load all" polling...');
                // Wait a bit for the initial export click to register, then start polling
                setTimeout(() => {
                    pollForLoadAllButton(csvType);
                }, 5000); // Start polling after 5 seconds
            }
            
            return true;
        } else {
            console.error('✗ Export CSV button not found in menu');
            chrome.runtime.sendMessage({
                action: 'exportFailed',
                csvType: csvType,
                error: 'Export CSV button not found in menu'
            });
            return false;
        }
    }, 500);
    
    return true;
}

// Add visual indicator (small, compact version)
const indicator = document.createElement('div');
indicator.textContent = '✓';
indicator.title = 'Plantiful CSV Test (Click to manually trigger export)';
indicator.style.cssText = 'position: fixed; bottom: 20px; right: 80px; background: rgba(0, 100, 200, 0.7); color: white; padding: 6px 10px; border-radius: 50%; z-index: 10000; font-size: 14px; font-weight: bold; cursor: pointer; box-shadow: 0 2px 4px rgba(0,0,0,0.2); transition: all 0.2s;';
indicator.onmouseenter = () => {
    indicator.style.background = 'rgba(0, 100, 200, 0.9)';
    indicator.style.transform = 'scale(1.1)';
};
indicator.onmouseleave = () => {
    indicator.style.background = 'rgba(0, 100, 200, 0.7)';
    indicator.style.transform = 'scale(1)';
};
indicator.onclick = () => {
    console.log('Manual test button clicked!');
    triggerExport('manual-test');
};
document.body.appendChild(indicator);

// Listen for messages from background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('Content script received message:', message);
    
    if (message.action === 'checkReady') {
        // Background is polling to see if we're ready
        const ready = checkIfReady();
        sendResponse({ ready: ready });
        return true;
    }
    
    if (message.action === 'exportCSV') {
        triggerExport(message.csvType);
        sendResponse({ status: 'triggered' });
        return true;
    }
    
    return true;
});

console.log('✓ Content script ready with data row verification!');