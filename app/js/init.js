// ==================== init.js ====================
// Initialization: runs on page load.
// Loads saved account size, API keys, triggers initial render.

// ==================== INITIAL LOAD ====================
try { loadAnalysisApiKey(); } catch(e) {}
try { renderAnalysis(); } catch(e) {}
refreshAll();
checkFirstRun();
