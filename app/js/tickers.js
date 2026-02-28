// ==================== tickers.js ====================
// SCAN_TICKERS: S&P 500 + optionable large caps + ADRs + ETFs used by all scanners.
// Edit this file to customize the scan universe.

// ==================== GLOBAL SCAN WATCHLIST (S&P 500 + Optionable Large Caps + Custom) ====================
var SCAN_TICKERS = [
    // ── S&P 500 ──
    'AAPL','ABBV','ABT','ACN','ADBE','ADI','ADM','ADP','ADSK','AEE','AEP','AES','AFL','AIG','AIZ','AJG','AKAM','ALB','ALGN','ALK',
    'ALL','ALLE','AMAT','AMCR','AMD','AME','AMGN','AMP','AMT','AMZN','ANET','ANSS','AON','AOS','APA','APD','APH','APTV','ARE','ATO',
    'AVGO','AVY','AWK','AXP','AZO','BA','BAC','BAX','BBWI','BBY','BDX','BEN','BG','BIIB','BIO','BK','BKNG','BKR','BLDR','BLK',
    'BMY','BR','BRO','BSX','BWA','BX','BXP','C','CAG','CAH','CARR','CAT','CB','CBOE','CBRE','CCI','CCL','CDAY','CDNS','CDW',
    'CE','CEG','CF','CFG','CHD','CHRW','CHTR','CI','CINF','CL','CLX','CMCSA','CME','CMG','CMI','CMS','CNC','CNP','COF','COO',
    'COP','COR','COST','CPAY','CPB','CPRT','CPT','CRL','CRM','CRWD','CSCO','CSGP','CSX','CTAS','CTLT','CTRA','CTSH','CTVA','CVS','CVX',
    'CZR','D','DAL','DD','DE','DECK','DFS','DG','DGX','DHI','DHR','DIS','DLTR','DOV','DOW','DPZ','DRI','DTE','DUK',
    'DVA','DVN','DXCM','EA','EBAY','ECL','ED','EFX','EIX','EL','EMN','EMR','ENPH','EOG','EPAM','EQIX','EQR','EQT','ES','ESS',
    'ETN','ETR','EVRG','EW','EXC','EXPD','EXPE','EXR','F','FANG','FAST','FBHS','FCX','FDS','FDX','FE','FFIV','FI','FICO','FIS',
    'FISV','FITB','FMC','FOX','FOXA','FRT','FSLR','FTNT','FTV','GD','GDDY','GE','GEHC','GEN','GEV','GILD','GIS','GL','GLW',
    'GM','GNRC','GOOG','GOOGL','GPC','GPN','GRMN','GS','GWW','HAL','HAS','HBAN','HCA','HD','HOLX','HON','HPE','HPQ','HRL','HSIC',
    'HST','HSY','HUBB','HUM','HWM','IBM','ICE','IDXX','IEX','IFF','INCY','INTC','INTU','INVH','IP','IPG','IQV','IR','IRM','ISRG',
    'IT','ITW','IVZ','J','JBHT','JBL','JCI','JKHY','JNJ','JNPR','JPM','KDP','KEY','KEYS','KHC','KIM','KKR','KLAC','KMB',
    'KMI','KMX','KO','KR','KVUE','L','LDOS','LEN','LH','LHX','LIN','LKQ','LLY','LMT','LNT','LOW','LRCX','LULU','LUV','LVS',
    'LW','LYB','LYV','MA','MAA','MAR','MAS','MCD','MCHP','MCK','MCO','MDLZ','MDT','MET','META','MGM','MHK','MKC','MKTX','MLM',
    'MMC','MMM','MNST','MO','MOH','MOS','MPC','MPWR','MRK','MRNA','MRVL','MS','MSCI','MSFT','MSI','MTB','MTCH','MTD','MU','NCLH',
    'NDAQ','NDSN','NEE','NEM','NFLX','NI','NKE','NOC','NOW','NRG','NSC','NTAP','NTRS','NUE','NVDA','NVR','NWS','NWSA','NXPI','O',
    'ODFL','OKE','OMC','ON','ORCL','ORLY','OTIS','OXY','PANW','PARA','PAYC','PAYX','PCAR','PCG','PEG','PEP','PFE','PFG','PG','PGR',
    'PH','PHM','PKG','PLD','PLTR','PM','PNC','PNR','PNW','POOL','PPG','PPL','PRU','PSA','PSX','PTC','PVH','PWR','PYPL','QCOM',
    'QRVO','RCL','REG','REGN','RF','RJF','RL','RMD','ROK','ROL','ROP','ROST','RSG','RTX','RVTY','SBAC','SBUX','SCHW','SEE','SHW',
    'SJM','SLB','SMCI','SNA','SNPS','SO','SOLV','SPG','SPGI','SRE','STE','STLD','STT','STX','STZ','SWK','SWKS','SYF','SYK','SYY',
    'T','TAP','TDG','TDY','TECH','TEL','TER','TFC','TFX','TGT','TJX','TMO','TMUS','TPR','TRGP','TRMB','TROW','TRV','TSCO','TSLA',
    'TSN','TT','TTWO','TXN','TXT','TYL','UAL','UBER','UDR','UHS','ULTA','UNH','UNP','UPS','URI','USB','V','VICI','VLO','VLTO',
    'VMC','VRSK','VRSN','VRTX','VST','VTR','VTRS','VZ','WAB','WAT','WBA','WBD','WDC','WEC','WELL','WFC','WM','WMB','WMT','WRB',
    'WST','WTW','WY','WYNN','XEL','XOM','XYL','YUM','ZBH','ZBRA','ZTS',
    // ── Optionable Mid/Large Caps (high liquidity, active options) ──
    'ALLY','AXON','BALL','BWXT','CHDN','COHR','CROX','DKS','DOCS','DUOL','ETSY','FIVE','IBKR','MANH','MSTR','OVV','PSTG','RH',
    'SAIA','SKX','SOFI','SPOT','TOST','WING','XPO','ZS','MDB','HIMS','ELF','CAVA','CELH','ONON','RBRK',
    // ── ADRs & Non-S&P Large Caps ──
    'TM','ASML','NVS','HSBC','MELI','SNOW','COIN','HOOD','TTD','APP','RKLB','DKNG','DASH','PINS','ROKU','U','NET','DDOG',
    'NVO','ARM','TSM','SQ','SNAP','LYFT','ABNB','HLT','AAL','SHOP',
    // ── Miners & Commodities ──
    'FSM','AG','PAAS','WPM','MARA','RIOT','CLSK','BTU','CLF',
    // ── ETFs ──
    'SPY','QQQ','IWM','DIA','XLF','XLE','XLK','XLV','XLI','GLD','SLV','TLT','HYG','ARKK','SMH','BITX'
];
var SCAN_UNIQUE = [...new Set(SCAN_TICKERS)];

// ==================== SMA COMPRESSION + RVOL SCANNER (SCORED 0-100) ====================
