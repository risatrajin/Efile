"""Tier-specific document checklists and review checklists. Source of truth for the pilot."""

# Tier pricing (internal only - never exposed to CLIENT role)
TIER_PRICING = {
    "BOOKS_COMPLETE": 750,
    "STANDARD": 1000,
    "WHITE_GLOVE": 2500,
}

# Internal CPA hourly cost for margin calc
CPA_HOURLY_COST = 120

# Document checklists by tier
DOC_CATEGORIES_LABEL = {
    "PRIOR_T2": "Prior year T2 return",
    "PRIOR_FINANCIALS": "Prior year financial statements",
    "PRIOR_NOA": "Prior year Notice of Assessment",
    "CURRENT_TRIAL_BALANCE": "Current year trial balance",
    "BANK_STATEMENTS": "Bank statements (12 months)",
    "BROKERAGE_STATEMENTS": "Brokerage statements (all accounts)",
    "TRADE_CONFIRMATIONS": "Trade confirmations / realized gains",
    "ACB_RECORDS": "ACB records",
    "BOOKKEEPING_RECORDS": "Bookkeeping records / software exports",
    "ARTICLES_OF_INCORP": "Articles of incorporation",
    "PERSONAL_T1": "Personal T1 return",
    "RRSP_ROOM": "RRSP contribution room",
    "INSURANCE_POLICIES": "Insurance policies",
    "HOLDCO_FINANCIALS": "Holdco financial statements and T2",
    "TRUST_DOCUMENTS": "Trust documents",
    "SHAREHOLDER_AGREEMENT": "Shareholder agreement",
    "ESTATE_DOCUMENTS": "Estate planning documents",
    "CRA_CORRESPONDENCE": "CRA correspondence",
    "REGISTERED_ACCOUNTS": "Registered account statements (RRSP/TFSA/RESP/LIRA/IPP)",
    "PAYROLL_RECORDS": "Payroll records / T4-T5",
    "CREDIT_CARD_STATEMENTS": "Credit card statements",
    "CORPORATE_LOANS": "Corporate loan/mortgage statements",
    "SHAREHOLDER_LOAN": "Shareholder loan details",
    "OTHER": "Other",
}

def docs_for_tier(tier: str):
    """Return list of dicts {category, description, required, sort_order} for tier."""
    base = [
        ("PRIOR_T2", "Needed to cross-check balances and continuities", True),
        ("PRIOR_FINANCIALS", "Prior fiscal year NTR or audited statements", True),
        ("PRIOR_NOA", "Latest Notice of Assessment from CRA", True),
        ("CURRENT_TRIAL_BALANCE", "From QuickBooks, Xero or spreadsheet", True),
        ("BANK_STATEMENTS", "All corporate bank accounts", True),
        ("ARTICLES_OF_INCORP", "First engagement only", True),
        ("PAYROLL_RECORDS", "If you issued T4 or T5 slips", False),
        ("SHAREHOLDER_LOAN", "Year-end shareholder loan reconciliation", False),
    ]
    if tier in ("STANDARD", "WHITE_GLOVE"):
        base += [
            ("BROKERAGE_STATEMENTS", "All corporate investment accounts", True),
            ("TRADE_CONFIRMATIONS", "Year-end realized gains/losses report", True),
            ("ACB_RECORDS", "Adjusted cost base records if available", False),
            ("BOOKKEEPING_RECORDS", "If books not finalized", False),
            ("CREDIT_CARD_STATEMENTS", "If business expenses mixed", False),
            ("CORPORATE_LOANS", "Corporate loan/mortgage statements", False),
        ]
    if tier == "WHITE_GLOVE":
        base += [
            ("REGISTERED_ACCOUNTS", "RRSP, TFSA, RESP, LIRA, IPP statements", True),
            ("PERSONAL_T1", "Prior year personal T1 return", True),
            ("RRSP_ROOM", "Latest RRSP contribution room (from CRA)", True),
            ("INSURANCE_POLICIES", "For planning review", False),
            ("HOLDCO_FINANCIALS", "If holdco exists", False),
            ("TRUST_DOCUMENTS", "If family trust exists", False),
            ("SHAREHOLDER_AGREEMENT", "For CDA / dividend planning", False),
            ("ESTATE_DOCUMENTS", "If client requests estate review", False),
        ]
    return [
        {
            "category": cat,
            "name": DOC_CATEGORIES_LABEL[cat],
            "description": desc,
            "is_required": req,
            "sort_order": i,
        }
        for i, (cat, desc, req) in enumerate(base)
    ]


# Review checklist per tier
def review_checklist_for_tier(tier: str):
    base = [
        "T2 return complete",
        "Financial statements (NTR) prepared",
        "T4/T5 slips generated",
        "CDA schedule verified against prior year NOA",
        "SBD calculation with passive income check",
        "Prior year cross-check",
        "QA sign-off",
    ]
    if tier in ("STANDARD", "WHITE_GLOVE"):
        base += [
            "Investment reconciliation complete",
            "ACB tracking verified",
            "Passive income threshold assessed",
            "Compensation summary prepared",
        ]
    if tier == "WHITE_GLOVE":
        base += [
            "Compensation analysis memo drafted",
            "CDA optimization analysis complete",
            "Year-end planning summary written",
            "Opportunities memo prepared (for WS)",
            "Senior review QA sign-off",
        ]
    return [{"item": item, "sort_order": i, "is_completed": False} for i, item in enumerate(base)]


STATUS_LABELS = {
    "REFERRED": "Referred",
    "INTAKE": "Intake",
    "IN_PREP": "In prep",
    "IN_REVIEW": "In review",
    "DELIVERY": "Delivery",
    "FILED": "Filed",
    "POST_FILING": "Post-filing",
}

TIER_LABELS = {
    "BOOKS_COMPLETE": "Books Complete",
    "STANDARD": "Standard",
    "WHITE_GLOVE": "White-Glove",
}

OPP_LABELS = {
    "COMPENSATION_STRATEGY": "Compensation strategy",
    "SBD_CLAWBACK": "SBD clawback",
    "CDA_EXTRACTION": "CDA extraction",
    "HOLDCO_STRUCTURE": "Holdco structure",
    "IPP_CANDIDATE": "IPP candidate",
    "ESTATE_PLANNING": "Estate planning",
    "RDTOH_OPTIMIZATION": "RDTOH optimization",
    "INSURANCE_GAP": "Insurance gap",
    "PRIOR_YEAR_ERROR": "Prior year error",
    "OTHER": "Other",
}

TIME_LABELS = {
    "DOCUMENT_REVIEW": "Document review",
    "BOOKKEEPING_CLEANUP": "Bookkeeping cleanup",
    "INVESTMENT_RECONCILIATION": "Investment reconciliation",
    "T2_PREPARATION": "T2 preparation",
    "REVIEW_QA": "Review / QA",
    "PLANNING_MEMO": "Planning memo",
    "CLIENT_CALL": "Client call",
    "CRA_CORRESPONDENCE": "CRA correspondence",
    "OTHER": "Other",
}
