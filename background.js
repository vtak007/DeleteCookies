chrome.action.onClicked.addListener(async (tab) => {
  if (!tab || !tab.url) return;
  
  try {
    const url = new URL(tab.url);
    const hostname = url.hostname;
    const baseDomain = hostname.replace(/^www\./, '');
    
    console.log(`----- COOKIE DELETION START -----`);
    console.log(`Target site: ${hostname} (Base domain: ${baseDomain})`);
    
    // Get all cookies first so we can log what exists
    chrome.cookies.getAll({}, (allCookies) => {
      console.log(`Total cookies in browser: ${allCookies.length}`);
      
      // Find exact domain matches for detailed logging
      const exactDomainMatches = allCookies.filter(c => 
        c.domain === hostname || 
        c.domain === '.' + hostname
      );
      console.log(`Cookies with exact domain '${hostname}' or '.${hostname}': ${exactDomainMatches.length}`);
      
      // Log these exact matches for debugging
      if (exactDomainMatches.length > 0) {
        console.log("Exact domain matches:");
        exactDomainMatches.forEach(c => {
          console.log(`- ${c.name} (domain: ${c.domain}, path: ${c.path}, httpOnly: ${c.httpOnly}, secure: ${c.secure})`);
        });
      }
      
      // Find base domain matches
      const baseDomainMatches = allCookies.filter(c => 
        c.domain === baseDomain || 
        c.domain === '.' + baseDomain ||
        c.domain.endsWith('.' + baseDomain)
      );
      console.log(`Cookies with base domain '${baseDomain}' or related: ${baseDomainMatches.length}`);
      
      // Combined approach for deletion
      const cookiesToDelete = [...new Set([...exactDomainMatches, ...baseDomainMatches])];
      console.log(`Total unique cookies to delete: ${cookiesToDelete.length}`);
      
      if (cookiesToDelete.length > 0) {
        deleteAllMatchingCookies(tab, cookiesToDelete, hostname);
      } else {
        // Try direct deletion since we couldn't find matching cookies
        executeDirectCookieDeletion(tab, hostname, baseDomain);
      }
    });
  } catch (error) {
    console.error("Error in cookie deletion:", error);
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (errorMsg) => {
        alert(`Error clearing cookies: ${errorMsg}`);
      },
      args: [error.message]
    });
  }
});

// Function to delete cookies using chrome.cookies.remove
function deleteAllMatchingCookies(tab, cookies, hostname) {
  let deletedCount = 0;
  let totalAttempts = cookies.length * 2; // 2 attempts per cookie (http/https)
  let completedAttempts = 0;
  
  if (cookies.length === 0) {
    showAlert(tab, hostname, 0);
    return;
  }
  
  // Log all cookies we're attempting to delete
  console.log("Attempting to delete these cookies:");
  cookies.forEach((c, index) => {
    console.log(`${index+1}. ${c.name} (domain: ${c.domain}, path: ${c.path})`);
  });
  
  cookies.forEach(cookie => {
    // For more reliable deletion, we need to handle domain prefixes properly
    const cookieDomain = cookie.domain.startsWith('.') ? cookie.domain.substring(1) : cookie.domain;
    
    // Try both secure and non-secure URLs for more complete deletion
    ['https://', 'http://'].forEach(protocol => {
      const cookieUrl = `${protocol}${cookieDomain}${cookie.path}`;
      
      chrome.cookies.remove({
        url: cookieUrl,
        name: cookie.name,
        storeId: cookie.storeId
      }, (result) => {
        completedAttempts++;
        
        if (result) {
          console.log(`✓ Successfully deleted cookie: ${cookie.name} from ${cookieUrl}`);
          deletedCount++;
        } else {
          console.warn(`✗ Failed to delete cookie: ${cookie.name} from ${cookieUrl} (Error: ${chrome.runtime.lastError ? chrome.runtime.lastError.message : 'Unknown'})`);
        }
        
        // Check if we've processed all cookies
        if (completedAttempts >= totalAttempts) {
          console.log(`Deleted ${deletedCount} out of ${cookies.length} cookies via API`);
          
          // After API deletion, check what cookies remain for this domain
          checkRemainingCookies(tab, hostname, deletedCount);
        }
      });
    });
  });
}

// Function to check what cookies remain after deletion attempt
function checkRemainingCookies(tab, hostname, alreadyDeletedCount) {
  const baseDomain = hostname.replace(/^www\./, '');
  
  chrome.cookies.getAll({}, (allCookies) => {
    // Find remaining cookies for our domain
    const remainingExactMatches = allCookies.filter(c => 
      c.domain === hostname || 
      c.domain === '.' + hostname
    );
    
    const remainingBaseMatches = allCookies.filter(c => 
      c.domain === baseDomain || 
      c.domain === '.' + baseDomain ||
      c.domain.endsWith('.' + baseDomain)
    );
    
    const remainingTotal = [...new Set([...remainingExactMatches, ...remainingBaseMatches])];
    
    console.log(`After API deletion, ${remainingTotal.length} cookies remain for this domain`);
    
    if (remainingTotal.length > 0) {
      console.log("Remaining cookies:");
      remainingTotal.forEach(c => {
        console.log(`- ${c.name} (domain: ${c.domain}, path: ${c.path}, httpOnly: ${c.httpOnly})`);
      });
      
      // Try direct deletion for these remaining cookies
      console.log("Attempting direct deletion for remaining cookies");
      executeDirectCookieDeletion(tab, hostname, baseDomain, alreadyDeletedCount);
    } else {
      console.log("No cookies remain for this domain!");
      showAlert(tab, hostname, alreadyDeletedCount);
    }
  });
}

// Function to execute direct cookie deletion via content script
function executeDirectCookieDeletion(tab, hostname, baseDomain, previouslyDeletedCount = 0) {
  console.log("Attempting direct cookie deletion via executeScript");
  
  chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: (hostname, baseDomain) => {
      // Helper function to log to both content script and background script
      function log(msg) {
        console.log(msg);
        return msg; // Return so it can be collected in results
      }
      
      // Get all cookies
      const cookiesStr = document.cookie;
      const cookies = cookiesStr.split(';').filter(c => c.trim() !== '');
      
      log(`Direct deletion: Document has ${cookies.length} cookies before deletion`);
      if (cookies.length > 0) {
        log("Cookies found in document.cookie:");
        cookies.forEach(c => log(`- ${c.trim()}`));
      }
      
      let deletedCount = 0;
      const logs = [];
      
      // For each cookie, try multiple deletion approaches
      if (cookies.length > 0) {
        cookies.forEach(cookie => {
          const cookieName = cookie.split('=')[0].trim();
          logs.push(`Attempting to delete cookie: ${cookieName}`);
          
          // Delete for various path and domain combinations
          const paths = ['/', '', '//', document.location.pathname];
          const domains = [
            '', // No domain specified
            hostname,
            '.' + hostname,
            baseDomain,
            '.' + baseDomain,
            window.location.hostname,
            '.' + window.location.hostname
          ];
          
          paths.forEach(path => {
            domains.forEach(domain => {
              // Build deletion string based on whether we have a domain
              let deletionStr;
              if (domain) {
                deletionStr = `${cookieName}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=${path}; domain=${domain}`;
              } else {
                deletionStr = `${cookieName}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=${path}`;
              }
              
              // Apply the cookie deletion
              document.cookie = deletionStr;
              logs.push(`Set: ${deletionStr}`);
            });
          });
          
          deletedCount++;
        });
      }
      
      // Advanced technique: use localStorage to track if we've tried this approach
      let reloadAttemptCount = localStorage.getItem('cookieDeleteReloadCount') || 0;
      reloadAttemptCount = parseInt(reloadAttemptCount);
      
      // Check if cookies remain after our first attempt
      const remainingCookies = document.cookie.split(';').filter(c => c.trim() !== '');
      logs.push(`After deletion attempt, ${remainingCookies.length} cookies remain in document.cookie`);
      
      // If cookies remain and we haven't reloaded too many times, try reloading
      if (remainingCookies.length > 0 && reloadAttemptCount < 1) {
        localStorage.setItem('cookieDeleteReloadCount', reloadAttemptCount + 1);
        logs.push(`Will attempt reload trick to clear remaining cookies`);
        // We'll handle the actual reload in the result handler
        return { 
          deletedCount: deletedCount,
          remainingCount: remainingCookies.length, 
          needsReload: true,
          logs: logs
        };
      } else {
        // Reset counter and return results
        localStorage.removeItem('cookieDeleteReloadCount');
        return { 
          deletedCount: deletedCount,
          remainingCount: remainingCookies.length,
          needsReload: false,
          logs: logs
        };
      }
    },
    args: [hostname, baseDomain]
  }, (results) => {
    if (results && results[0] && results[0].result) {
      const result = results[0].result;
      
      // Log the content script's logs
      if (result.logs && result.logs.length) {
        console.log("Content script logs:");
        result.logs.forEach(logMsg => console.log(`> ${logMsg}`));
      }
      
      const directDeleteCount = result.deletedCount || 0;
      const totalDeleted = previouslyDeletedCount + directDeleteCount;
      
      console.log(`Content script deleted ${directDeleteCount} cookies directly`);
      console.log(`Total cookies deleted: ${totalDeleted}`);
      
      if (result.needsReload) {
        console.log("Reloading page to try to clear stubborn cookies...");
        // Execute another script to reload the page
        chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => {
            // Force reload from server
            window.location.reload(true);
          }
        });
        // We'll show the alert after the reload completes
        // Store the current count in local storage to retrieve after reload
        chrome.storage.local.set({
          'cookieDeleteCount': totalDeleted,
          'cookieDeleteDomain': hostname
        });
      } else {
        // Show how many cookies were deleted in total
        showFinalAlert(tab, hostname, totalDeleted, result.remainingCount);
      }
    } else {
      showFinalAlert(tab, hostname, previouslyDeletedCount, 0);
    }
  });
}

// Function to show final alert with more details
function showFinalAlert(tab, domain, deletedCount, remainingCount) {
  console.log(`----- COOKIE DELETION COMPLETE -----`);
  
  chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: (domain, deletedCount, remainingCount) => {
      let message;
      if (deletedCount > 0) {
        if (remainingCount > 0) {
          message = `Cleared ${deletedCount} cookies for ${domain}\n\n${remainingCount} cookies could not be deleted. These may require manual deletion through browser settings.`;
        } else {
          message = `Successfully cleared all ${deletedCount} cookies for ${domain}!`;
        }
      } else {
        message = `No cookies were deleted for ${domain}. Either none existed or they could not be removed by the extension.`;
      }
      alert(message);
    },
    args: [domain, deletedCount, remainingCount]
  });
}

// Simpler alert function
function showAlert(tab, domain, count) {
  chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: (domain, count) => {
      alert(`Cleared ${count} cookies for ${domain}`);
    },
    args: [domain, count]
  });
}