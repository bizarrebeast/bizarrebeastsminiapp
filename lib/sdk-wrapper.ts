// Bulletproof SDK wrapper with aggressive initialization and retry
import { sdk as farcasterSDK } from '@farcaster/miniapp-sdk';

// Global state
let initialized = false;
let initializing = false;
let initPromise: Promise<void> | null = null;
let sdkReady = false;
let initAttempts = 0;
const MAX_INIT_ATTEMPTS = 5;

// Helper to check if we're in a Farcaster context
const isInFarcasterContext = (): boolean => {
  if (typeof window === 'undefined') return false;
  
  // Multiple detection methods
  return (
    window.location !== window.parent?.location ||
    window.self !== window.top ||
    window.parent !== window ||
    // Check for Farcaster-specific properties
    'fcSignerRequestedAt' in window ||
    // Check URL params
    new URLSearchParams(window.location.search).has('fc_frame') ||
    // Check referrer
    document.referrer.includes('warpcast.com') ||
    document.referrer.includes('farcaster')
  );
};

// Aggressive initialization function
const initializeSDK = async (force = false): Promise<void> => {
  // If already initialized and not forcing, return
  if (initialized && !force) {
    console.log('✅ SDK already initialized');
    return;
  }
  
  // If currently initializing, wait for that to complete
  if (initializing && initPromise && !force) {
    console.log('⏳ SDK initialization in progress, waiting...');
    return initPromise;
  }
  
  // Start new initialization
  initializing = true;
  initAttempts++;
  
  initPromise = (async () => {
    try {
      console.log(`🚀 SDK initialization attempt ${initAttempts}/${MAX_INIT_ATTEMPTS}...`);
      
      // Step 1: Call ready() multiple times with delays
      for (let i = 0; i < 3; i++) {
        try {
          await farcasterSDK.actions.ready();
          console.log(`✅ SDK ready() call ${i + 1} succeeded`);
          await new Promise(resolve => setTimeout(resolve, 50)); // Small delay between calls
        } catch (error) {
          console.log(`⚠️ SDK ready() call ${i + 1} failed:`, error);
        }
      }
      
      // Step 2: Verify SDK is actually ready
      let isReady = false;
      for (let i = 0; i < 5; i++) {
        try {
          const isInMiniApp = await farcasterSDK.isInMiniApp();
          console.log(`✅ SDK verification ${i + 1}: isInMiniApp = ${isInMiniApp}`);
          isReady = true;
          break;
        } catch (error) {
          console.log(`⚠️ SDK verification ${i + 1} failed:`, error);
          await new Promise(resolve => setTimeout(resolve, 100 * (i + 1)));
        }
      }
      
      if (!isReady && initAttempts < MAX_INIT_ATTEMPTS) {
        console.log('❌ SDK not ready, retrying initialization...');
        initializing = false;
        await new Promise(resolve => setTimeout(resolve, 500));
        return initializeSDK(true);
      }
      
      // Step 3: Warm up the SDK with actual API calls
      if (isReady) {
        try {
          const context = await farcasterSDK.context;
          console.log('✅ SDK context fetched:', context?.client?.platformType);
          
          // Pre-warm the composeCast API
          if (isInFarcasterContext()) {
            // Make a dummy call to warm up the API (will be cancelled immediately)
            const controller = new AbortController();
            const warmupPromise = farcasterSDK.actions.composeCast({
              text: '',
              embeds: [],
            }).catch(() => {}); // Ignore errors
            
            // Cancel immediately
            setTimeout(() => controller.abort(), 10);
            await Promise.race([
              warmupPromise,
              new Promise(resolve => setTimeout(resolve, 100))
            ]);
            
            console.log('✅ SDK composeCast API warmed up');
          }
        } catch (error) {
          console.log('⚠️ SDK warmup failed (non-critical):', error);
        }
      }
      
      initialized = true;
      sdkReady = isReady;
      initializing = false;
      console.log('✅ SDK initialization complete, ready:', sdkReady);
      
    } catch (error) {
      console.error('❌ SDK initialization failed:', error);
      initializing = false;
      
      // Retry if under max attempts
      if (initAttempts < MAX_INIT_ATTEMPTS) {
        console.log('🔄 Retrying SDK initialization...');
        await new Promise(resolve => setTimeout(resolve, 1000));
        return initializeSDK(true);
      }
      
      // Mark as initialized anyway to not block the app
      initialized = true;
    }
  })();
  
  return initPromise;
};

// Initialize immediately on module load
if (typeof window !== 'undefined') {
  console.log('🎯 Starting aggressive SDK initialization on module load');
  initializeSDK();
  
  // Also initialize on various events as backup
  const events = ['DOMContentLoaded', 'load'];
  events.forEach(event => {
    if (document.readyState === 'loading' || document.readyState === 'interactive') {
      window.addEventListener(event, () => {
        console.log(`🎯 SDK initialization triggered by ${event}`);
        initializeSDK();
      }, { once: true });
    }
  });
  
  // Initialize after a delay as final backup
  setTimeout(() => {
    console.log('🎯 SDK initialization triggered by timeout');
    initializeSDK();
  }, 100);
}

// Enhanced retry wrapper with initialization guarantee
export const withSDKRetry = async <T>(
  operation: () => Promise<T>,
  maxRetries = 3,
  baseDelay = 100
): Promise<T> => {
  // Always ensure SDK is initialized first
  await initializeSDK();
  
  let lastError: any;
  
  for (let i = 0; i <= maxRetries; i++) {
    try {
      // Extra initialization check before each attempt
      if (!initialized || !sdkReady) {
        console.log('SDK not ready, forcing re-initialization...');
        await initializeSDK(true);
      }
      
      const result = await operation();
      console.log(`✅ SDK operation succeeded on attempt ${i + 1}`);
      return result;
      
    } catch (error: any) {
      lastError = error;
      console.log(`❌ SDK operation attempt ${i + 1}/${maxRetries + 1} failed:`, error?.message || error);
      
      if (i < maxRetries) {
        // Exponential backoff with jitter
        const delay = baseDelay * Math.pow(2, i) + Math.random() * 100;
        console.log(`⏳ Retrying in ${Math.round(delay)}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        
        // Force re-initialization on certain errors
        if (error?.message?.includes('not ready') || 
            error?.message?.includes('not initialized') ||
            error?.message?.includes('SDK')) {
          console.log('🔄 Force re-initializing SDK due to error');
          await initializeSDK(true);
        }
      }
    }
  }
  
  console.error('❌ All SDK operation attempts failed');
  throw lastError;
};

// Export functions for manual control
export const ensureSDKReady = () => initializeSDK();
export const isSDKReady = () => sdkReady;
export const waitForSDK = () => initPromise || initializeSDK();
export const forceSDKReinit = () => initializeSDK(true);

// Export the SDK instance
export { farcasterSDK as sdk };

// Check if SDK is truly ready by making a test call
const verifySDKReady = async (): Promise<boolean> => {
  try {
    // Try to check if we're in a miniapp - this is a lightweight call
    const result = await Promise.race([
      farcasterSDK.isInMiniApp(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 500))
    ]);
    console.log('✅ SDK verification successful:', result);
    return true;
  } catch (error) {
    console.log('❌ SDK not ready yet:', error);
    return false;
  }
};

// Composite function for share operations with extra safety
export const shareToFarcaster = async (params: {
  text: string;
  embeds?: string[];
  channelKey?: string;
  fallbackUrl?: string; // URL to use if SDK fails
}): Promise<any> => {
  console.log('📤 Starting Farcaster share with params:', params);
  
  // First, check if SDK is actually ready with a quick test
  const isReady = await verifySDKReady();
  
  if (!isReady) {
    console.log('⚠️ SDK not ready on first attempt, attempting aggressive initialization...');
    
    // Try aggressive initialization
    for (let i = 0; i < 5; i++) {
      await initializeSDK(true);
      await new Promise(resolve => setTimeout(resolve, 200 * (i + 1)));
      
      // Check if ready now
      const ready = await verifySDKReady();
      if (ready) {
        console.log(`✅ SDK ready after ${i + 1} initialization attempts`);
        break;
      }
    }
  }
  
  // Final readiness check
  const finalCheck = await verifySDKReady();
  
  if (!finalCheck) {
    console.log('❌ SDK still not ready after all attempts');
    
    // If we have a fallback URL and SDK isn't ready, use URL method
    if (params.fallbackUrl) {
      console.log('📱 Using fallback URL method for sharing');
      
      // For mobile, use location.href to trigger app open
      if (typeof window !== 'undefined' && /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)) {
        window.location.href = params.fallbackUrl;
      } else {
        // Desktop: open in new window
        window.open(params.fallbackUrl, '_blank');
      }
      
      return { fallback: true, url: params.fallbackUrl };
    }
    
    throw new Error('SDK not ready and no fallback URL provided');
  }
  
  // Convert embeds array to tuple format required by SDK
  const composeCastParams: any = {
    text: params.text,
    channelKey: params.channelKey,
  };
  
  // Handle embeds as tuple type
  if (params.embeds && params.embeds.length > 0) {
    if (params.embeds.length === 1) {
      composeCastParams.embeds = [params.embeds[0]] as [string];
    } else if (params.embeds.length >= 2) {
      composeCastParams.embeds = [params.embeds[0], params.embeds[1]] as [string, string];
    }
  }
  
  // Use the retry wrapper with the composeCast operation
  try {
    const result = await withSDKRetry(async () => {
      return await farcasterSDK.actions.composeCast(composeCastParams);
    }, 2, 300);
    
    console.log('✅ Share successful via SDK');
    return result;
  } catch (error) {
    console.error('❌ SDK share failed:', error);
    
    // Last resort: use fallback URL if available
    if (params.fallbackUrl) {
      console.log('📱 Falling back to URL method after SDK failure');
      
      if (typeof window !== 'undefined' && /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)) {
        window.location.href = params.fallbackUrl;
      } else {
        window.open(params.fallbackUrl, '_blank');
      }
      
      return { fallback: true, url: params.fallbackUrl, error: error };
    }
    
    throw error;
  }
};