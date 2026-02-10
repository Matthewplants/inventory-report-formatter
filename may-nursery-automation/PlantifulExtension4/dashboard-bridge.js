// Dashboard bridge v3 - Fixed message relay
console.log('Dashboard bridge v3 loaded for file:// URL');

// Listen for messages from the dashboard page
window.addEventListener('message', (event) => {
    // Only accept messages from same origin
    if (event.source !== window) return;
    
    if (event.data.type && event.data.type === 'DASHBOARD_TO_EXTENSION') {
        console.log('Bridge forwarding to extension:', event.data.payload);
        
        // Forward to extension background script
        chrome.runtime.sendMessage(event.data.payload, (response) => {
            console.log('Bridge received response from extension:', response);
            
            // Send response back to page with the messageId
            window.postMessage({
                type: 'EXTENSION_TO_DASHBOARD',
                messageId: event.data.messageId,
                payload: response
            }, '*');
        });
    }
});

// Listen for messages from extension background
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('Bridge received from extension background:', message);
    
    // Forward to dashboard page
    window.postMessage({
        type: 'EXTENSION_TO_DASHBOARD',
        payload: message
    }, '*');
    
    sendResponse({ status: 'forwarded' });
    return true;
});

// Notify page that bridge is ready
setTimeout(() => {
    window.postMessage({
        type: 'BRIDGE_READY'
    }, '*');
    console.log('✓ Dashboard bridge ready and listening');
}, 100);