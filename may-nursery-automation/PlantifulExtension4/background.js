console.log('Background script v28 - Fixed tab closing (was deleting tabId too early)');

let pendingCSVRequests = {};
let dashboardTabId = null;

// Helper function to close Plantiful tab after CSV transfer
function closeTabForCsvType(csvType) {
  const request = pendingCSVRequests[csvType];
  if (request && request.tabId) {
    console.log(`Closing ${csvType} tab (ID: ${request.tabId}) after successful transfer...`);
    setTimeout(() => {
      chrome.tabs.remove(request.tabId, () => {
        if (chrome.runtime.lastError) {
          console.log(`Tab ${request.tabId} already closed or not found`);
        } else {
          console.log(`✓ ${csvType} tab closed successfully`);
        }
        // Delete the pending request after closing
        delete pendingCSVRequests[csvType];
      });
    }, 1000); // Wait 1 second to ensure dashboard has processed the data
  } else {
    console.log(`⚠️ Cannot close ${csvType} tab - no tabId found in pending requests`);
  }
}

// Monitor downloads
chrome.downloads.onCreated.addListener((downloadItem) => {
  console.log('=== DOWNLOAD DETECTED ===');
  console.log('Filename:', downloadItem.filename);
  console.log('MIME:', downloadItem.mime);
  console.log('URL:', downloadItem.url);
  console.log('========================');
  
  // Check MIME type
  if (downloadItem.mime && downloadItem.mime.includes('csv')) {
    console.log('✓ CSV file detected (by MIME type)!');
    
    // Identify CSV type
    let csvType = 'unknown';
    if (pendingCSVRequests.production) {
      csvType = 'production';
      console.log('Identified as Production Items');
    } else if (pendingCSVRequests.lineitems) {
      csvType = 'lineitems';
      console.log('Identified as Line Items');
    }
    
    console.log('CSV type:', csvType);
    
    // Fetch the blob URL to get CSV content
    if (downloadItem.url && downloadItem.url.startsWith('blob:')) {
      console.log('Fetching blob URL to read CSV data...');
      
      fetch(downloadItem.url)
        .then(response => response.text())
        .then(csvText => {
          console.log('✓ CSV data read successfully!');
          console.log('CSV length:', csvText.length, 'characters');
          console.log('CSV size:', (csvText.length / 1024 / 1024).toFixed(2), 'MB');
          
          // Send CSV data to dashboard
          if (dashboardTabId) {
            // Check if CSV is large (> 1MB = needs chunking)
            const isLarge = csvText.length > 1048576; // 1MB
            
            if (isLarge) {
              console.log('📦 Large CSV detected - sending in chunks...');
              sendCsvInChunks(csvText, csvType, downloadItem.filename);
            } else {
              console.log('📤 Small CSV - sending in one message...');
              chrome.tabs.sendMessage(dashboardTabId, {
                action: 'csvReceived',
                csvType: csvType,
                csvData: csvText,
                filename: downloadItem.filename || `${csvType}.csv`
              }, (response) => {
                console.log('✓ CSV sent to dashboard!');
                // Close the Plantiful tab after successful transfer
                closeTabForCsvType(csvType);
              });
            }
          } else {
            console.warn('⚠️ No dashboard tab registered');
          }
          
          console.log('✓ Done! CSV sent to dashboard, tab will close automatically.');
        })
        .catch(error => {
          console.error('✗ Error reading CSV data:', error);
        });
    }
  } else {
    console.log('Not a CSV (MIME type check failed)');
  }
});

// Function to send large CSV in chunks
function sendCsvInChunks(csvText, csvType, filename) {
  // Split by lines
  const lines = csvText.split('\n');
  const header = lines[0]; // First line is header
  const dataLines = lines.slice(1); // Rest is data
  
  const chunkSize = 2000; // Send 2000 rows at a time
  const totalChunks = Math.ceil(dataLines.length / chunkSize);
  
  console.log(`Splitting ${dataLines.length} rows into ${totalChunks} chunks of ${chunkSize} rows each`);
  
  // Send start message
  chrome.tabs.sendMessage(dashboardTabId, {
    action: 'csvChunkedStart',
    csvType: csvType,
    filename: filename || `${csvType}.csv`,
    header: header,
    totalChunks: totalChunks,
    totalRows: dataLines.length
  });
  
  // Send each chunk
  let chunkIndex = 0;
  function sendNextChunk() {
    if (chunkIndex >= totalChunks) {
      // All chunks sent - send complete message
      console.log('✓ All chunks sent! Sending completion message...');
      chrome.tabs.sendMessage(dashboardTabId, {
        action: 'csvChunkedComplete',
        csvType: csvType
      }, (response) => {
        // Close the Plantiful tab after successful transfer
        closeTabForCsvType(csvType);
      });
      return;
    }
    
    const start = chunkIndex * chunkSize;
    const end = Math.min(start + chunkSize, dataLines.length);
    const chunkLines = dataLines.slice(start, end);
    const chunkData = chunkLines.join('\n');
    
    console.log(`Sending chunk ${chunkIndex + 1}/${totalChunks} (rows ${start + 1}-${end})`);
    
    chrome.tabs.sendMessage(dashboardTabId, {
      action: 'csvChunk',
      csvType: csvType,
      chunkIndex: chunkIndex,
      chunkData: chunkData,
      isLastChunk: (chunkIndex === totalChunks - 1)
    });
    
    chunkIndex++;
    
    // Send next chunk after a brief delay (don't flood the message queue)
    setTimeout(sendNextChunk, 50); // 50ms between chunks
  }
  
  // Start sending chunks
  sendNextChunk();
}

// Smart polling function - checks if page is ready
function pollForReadyState(tabId, csvType, attemptNumber = 0, maxAttempts = 30) {
  const attemptIntervalMs = 3000; // Check every 3 seconds
  
  if (attemptNumber >= maxAttempts) {
    console.error(`✗ Timeout after ${maxAttempts} attempts (${maxAttempts * attemptIntervalMs / 1000} seconds)`);
    
    // Notify dashboard of failure
    if (dashboardTabId) {
      chrome.tabs.sendMessage(dashboardTabId, {
        action: 'csvFailed',
        csvType: csvType,
        error: 'Timeout waiting for page to be ready'
      });
    }
    
    // Clean up
    if (pendingCSVRequests[csvType]) {
      chrome.tabs.remove(tabId);
      delete pendingCSVRequests[csvType];
    }
    return;
  }
  
  console.log(`Polling attempt ${attemptNumber + 1}/${maxAttempts}...`);
  
  // Try to send the export message
  chrome.tabs.sendMessage(tabId, { 
    action: 'checkReady',
    csvType: csvType
  }, (response) => {
    if (chrome.runtime.lastError) {
      console.log('Content script not ready yet, will retry...');
      setTimeout(() => pollForReadyState(tabId, csvType, attemptNumber + 1, maxAttempts), attemptIntervalMs);
    } else if (response && response.ready) {
      console.log('✓ Page is ready! Triggering export...');
      chrome.tabs.sendMessage(tabId, { 
        action: 'exportCSV',
        csvType: csvType
      });
    } else {
      console.log('Page loaded but button not ready yet, will retry...');
      setTimeout(() => pollForReadyState(tabId, csvType, attemptNumber + 1, maxAttempts), attemptIntervalMs);
    }
  });
}

// Listen for messages
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Background received message:', message);
  
  // Dashboard registration
  if (message.action === 'dashboardReady') {
    dashboardTabId = sender.tab.id;
    console.log('✓ Dashboard registered, tab ID:', dashboardTabId);
    sendResponse({ status: 'registered' });
    return true;
  }
  
  // Get Production CSV request
  if (message.action === 'getProductionCSV') {
    console.log('Request to get Production CSV');
    
    pendingCSVRequests.production = { 
      requestTime: Date.now(),
      tabId: null 
    };
    
    const productionUrl = 'https://app.tryplantiful.com/organizations/may-nursery/production/items';
    
    chrome.tabs.create({ url: productionUrl, active: true }, (tab) => {
      console.log('Opened Production page in tab:', tab.id);
      pendingCSVRequests.production.tabId = tab.id;
      
      chrome.tabs.onUpdated.addListener(function listener(tabId, info) {
        if (tabId === tab.id && info.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(listener);
          
          console.log('Page status complete, starting smart polling...');
          setTimeout(() => {
            pollForReadyState(tab.id, 'production');
          }, 5000);
        }
      });
    });
    
    sendResponse({ status: 'started' });
    return true;
  }
  
  // Get Line Items CSV request
  if (message.action === 'getLineItemsCSV') {
    console.log('Request to get Line Items CSV');
    
    pendingCSVRequests.lineitems = { 
      requestTime: Date.now(),
      tabId: null 
    };
    
    const lineItemsUrl = 'https://app.tryplantiful.com/organizations/may-nursery/sales/line-items';
    
    chrome.tabs.create({ url: lineItemsUrl, active: true }, (tab) => {
      console.log('Opened Line Items page in tab:', tab.id);
      pendingCSVRequests.lineitems.tabId = tab.id;
      
      chrome.tabs.onUpdated.addListener(function listener(tabId, info) {
        if (tabId === tab.id && info.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(listener);
          
          console.log('Page status complete, waiting briefly then checking for data...');
          setTimeout(() => {
            console.log('Starting smart polling with data verification...');
            pollForReadyState(tab.id, 'lineitems');
          }, 10000);
        }
      });
    });
    
    sendResponse({ status: 'started' });
    return true;
  }
  
  if (message.action === 'exportTriggered') {
    console.log('Export triggered for:', message.csvType);
    sendResponse({ status: 'ok' });
    return true;
  }
  
  if (message.action === 'loadAllClicked') {
    console.log('✓ "Load all" clicked for:', message.csvType);
    console.log('Now waiting for the long export (~15-20 minutes)...');
    sendResponse({ status: 'ok' });
    return true;
  }
  
  if (message.action === 'exportFailed') {
    console.log('✗ Export failed for:', message.csvType);
    
    if (dashboardTabId) {
      chrome.tabs.sendMessage(dashboardTabId, {
        action: 'csvFailed',
        csvType: message.csvType,
        error: message.error
      });
    }
    
    if (pendingCSVRequests[message.csvType]) {
      const tabId = pendingCSVRequests[message.csvType].tabId;
      if (tabId) {
        chrome.tabs.remove(tabId);
      }
      delete pendingCSVRequests[message.csvType];
    }
    
    sendResponse({ status: 'ok' });
    return true;
  }
  
  return true;
});

console.log('✓ Background script v28 ready - Tab closing fixed!');