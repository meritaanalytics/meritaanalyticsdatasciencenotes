"""fintech_db.py - builds a synthetic Kenyan digital-finance SQLite database.

Everything is generated with fixed random seeds, so every number is reproducible.
No row describes a real person, bank or lender.
"""
import os
import sqlite3
import numpy as np
import pandas as pd

COUNTIES = ["Nairobi", "Mombasa", "Kisumu", "Nakuru", "Eldoret",
            "Kiambu", "Machakos", "Kakamega", "Nyeri", "Kisii"]
COUNTY_P = [.35, .12, .08, .10, .07, .10, .05, .05, .04, .04]
OCC = ["Salaried", "Self-employed", "Trader", "Farmer", "Boda rider", "Student"]
OCC_P = [.30, .22, .20, .10, .10, .08]
OCC_INCOME = {"Salaried": 65000, "Self-employed": 55000, "Trader": 40000,
              "Farmer": 25000, "Boda rider": 28000, "Student": 12000}
TXN_TYPES = ["Send Money", "Withdrawal", "Deposit", "Bill Payment", "Airtime", "Loan Repayment"]
TXN_MEDIAN = {"Send Money": 2000, "Withdrawal": 3000, "Deposit": 5000,
              "Bill Payment": 1500, "Airtime": 100, "Loan Repayment": 3500}
PRODUCTS = ["Digital Loan", "Salary Advance", "SME Loan", "Asset Finance"]
PRODUCT_SIZE = {"Digital Loan": 8000, "Salary Advance": 30000,
                "SME Loan": 250000, "Asset Finance": 600000}
PRODUCT_TERMS = {"Digital Loan": [1, 2, 3], "Salary Advance": [1, 2, 3],
                 "SME Loan": [6, 12, 18, 24], "Asset Finance": [24, 36, 48]}
PRODUCT_RATE = {"Digital Loan": (36, 60), "Salary Advance": (15, 24),
                "SME Loan": (14, 22), "Asset Finance": (13, 18)}
DATA_END = pd.Timestamp("2025-12-31")


def build_fintech_db(path="fintech.db", seed=2024, n_customers=1000, n_txn=20000, n_loans=560):
    rng = np.random.default_rng(seed)
    if os.path.exists(path):
        os.remove(path)

    # ---- customers
    ids = [f"C{i:04d}" for i in range(1, n_customers + 1)]
    occ = rng.choice(OCC, n_customers, p=OCC_P)
    income = np.array([OCC_INCOME[o] for o in occ]) * rng.lognormal(0, 0.35, n_customers)
    customers = pd.DataFrame({
        "customer_id": ids,
        "age": np.clip(rng.normal(34, 9, n_customers), 18, 70).round().astype(int),
        "gender": rng.choice(["F", "M"], n_customers, p=[.48, .52]),
        "county": rng.choice(COUNTIES, n_customers, p=COUNTY_P),
        "occupation": occ,
        "monthly_income_ksh": np.round(income, -2).astype(int),
        "signup_date": (pd.Timestamp("2022-01-01")
                        + pd.to_timedelta(rng.integers(0, 912, n_customers), unit="D")
                        ).strftime("%Y-%m-%d"),
        "kyc_level": rng.choice(["Basic", "Standard", "Full"], n_customers, p=[.3, .5, .2]),
    })
    customers["segment"] = pd.cut(customers["monthly_income_ksh"], [0, 25000, 70000, np.inf],
                                  labels=["Mass", "Mid", "Affluent"], right=False).astype(str)

    # ---- transactions (December busier, Fridays and weekends busier)
    days = pd.date_range("2024-01-01", "2025-12-31")
    w = np.where(days.month == 12, 1.35, np.where(days.month == 1, 0.9, 1.0))
    w = w * np.where(days.dayofweek >= 4, 1.2, 1.0)
    day_idx = rng.choice(len(days), n_txn, p=w / w.sum())
    activity = rng.gamma(2.0, 1.0, n_customers)
    txn_type = rng.choice(TXN_TYPES, n_txn, p=[.30, .18, .15, .15, .12, .10])
    amount = np.array([TXN_MEDIAN[t] for t in txn_type]) * rng.lognormal(0, 0.8, n_txn)
    transactions = pd.DataFrame({
        "customer_id": rng.choice(ids, n_txn, p=activity / activity.sum()),
        "txn_date": days[day_idx].strftime("%Y-%m-%d"),
        "txn_type": txn_type,
        "channel": rng.choice(["M-Pesa", "Mobile App", "Agent", "ATM", "Branch"], n_txn,
                              p=[.55, .25, .12, .05, .03]),
        "amount_ksh": np.clip(np.round(amount, 2), 10, 250000),
        "status": rng.choice(["Success", "Failed", "Reversed"], n_txn, p=[.955, .035, .01]),
    }).sort_values("txn_date", kind="stable").reset_index(drop=True)
    transactions.insert(0, "txn_id", [f"T{i:06d}" for i in range(1, n_txn + 1)])

    # ---- fraud flags on large or reversed transactions
    big = transactions["amount_ksh"] > transactions["amount_ksh"].quantile(0.97)
    candidates = transactions.index[big | (transactions["status"] == "Reversed")]
    pick = np.sort(rng.choice(candidates, 220, replace=False))
    fraud_flags = pd.DataFrame({
        "flag_id": [f"F{i:04d}" for i in range(1, len(pick) + 1)],
        "txn_id": transactions.loc[pick, "txn_id"].values,
        "flagged_date": transactions.loc[pick, "txn_date"].values,
        "rule": rng.choice(["Large amount", "Velocity", "New device", "Reversal pattern"],
                           len(pick), p=[.4, .25, .2, .15]),
        "confirmed": rng.choice([0, 1], len(pick), p=[.8, .2]),
    })

    # ---- loans: default risk rises with a low score and a high instalment-to-income ratio
    b = customers.iloc[rng.integers(0, n_customers, n_loans)].reset_index(drop=True)
    product = rng.choice(PRODUCTS, n_loans, p=[.45, .25, .20, .10])
    principal = np.round(np.array([PRODUCT_SIZE[p] for p in product])
                         * rng.lognormal(0, 0.5, n_loans), -2)
    term = np.array([rng.choice(PRODUCT_TERMS[p]) for p in product])
    rate = np.round([rng.uniform(*PRODUCT_RATE[p]) for p in product], 1)
    score = np.clip(rng.normal(600, 55, n_loans)
                    + 25 * np.log(b["monthly_income_ksh"] / 40000), 300, 850).round().astype(int)
    instalment = principal * (1 + rate / 100 * term / 12) / term
    dti = instalment / b["monthly_income_ksh"]
    z = (score - 600) / 60
    logit = (-3.3 - 0.9 * z + 3.0 * dti + 0.3 * (product == "Digital Loan")
             - 0.3 * (b["occupation"] == "Salaried"))
    p_default = 1 / (1 + np.exp(-logit))
    disb = pd.Timestamp("2024-01-01") + pd.to_timedelta(rng.integers(0, 639, n_loans), unit="D")
    age_days = (DATA_END - disb).days.values
    defaulted = (rng.random(n_loans) < p_default) & (age_days >= 120)
    ended = (disb + pd.to_timedelta(term * 30, unit="D")) <= DATA_END
    status = np.where(defaulted, "Defaulted", np.where(ended, "Closed", "Active"))
    dpd = np.where(defaulted, np.minimum(rng.integers(91, 365, n_loans), np.maximum(91, age_days - 30)), 0)
    late = (status == "Active") & (rng.random(n_loans) > .8)
    dpd = np.where(late, rng.choice([5, 20, 35, 45, 70], n_loans), dpd)
    loans = pd.DataFrame({
        "loan_id": [f"L{i:04d}" for i in range(1, n_loans + 1)],
        "customer_id": b["customer_id"], "product": product, "principal_ksh": principal,
        "interest_rate_pct": rate, "term_months": term,
        "disbursement_date": disb.strftime("%Y-%m-%d"), "credit_score": score,
        "status": status, "days_past_due": dpd,
    })

    # ---- repayments: monthly instalments; defaulters stop paying part-way through
    rows = []
    for i, r in loans.iterrows():
        due_dates = [pd.Timestamp(r.disbursement_date) + pd.Timedelta(days=30 * k)
                     for k in range(1, int(r.term_months) + 1)]
        due_dates = [d for d in due_dates if d <= DATA_END]
        stop = rng.integers(0, max(1, len(due_dates))) if r.status == "Defaulted" else len(due_dates)
        if r.status == "Active" and r.days_past_due > 0 and due_dates:
            stop = len(due_dates) - 1
        for k, d in enumerate(due_dates):
            paid = k < stop
            delay = int(max(0, rng.normal(1.5, 3)))
            rows.append((f"R{len(rows) + 1:05d}", r.loan_id, d.strftime("%Y-%m-%d"),
                         (d + pd.Timedelta(days=delay)).strftime("%Y-%m-%d") if paid else None,
                         round(instalment[i], 2), round(instalment[i], 2) if paid else 0.0))
    repayments = pd.DataFrame(rows, columns=["repay_id", "loan_id", "due_date", "paid_date",
                                             "amount_due_ksh", "amount_paid_ksh"])

    # ---- fact table: transactions joined to customer attributes (a richer source of truth)
    fact = transactions.merge(customers[["customer_id", "county", "segment", "occupation"]],
                              on="customer_id", how="left", validate="many_to_one")
    d = pd.to_datetime(fact["txn_date"])
    fact["year"], fact["month"], fact["quarter"] = d.dt.year, d.dt.month, d.dt.quarter
    fact["day_of_week"] = d.dt.day_name()
    fact["is_weekend"] = (d.dt.dayofweek >= 5).astype(int)
    fact["amount_band"] = pd.cut(fact["amount_ksh"], [0, 500, 5000, 50000, np.inf],
                                 labels=["Micro", "Small", "Medium", "Large"]).astype(str)

    con = sqlite3.connect(path)
    for name, df in [("customers", customers), ("transactions", transactions),
                     ("fact_transactions", fact), ("fraud_flags", fraud_flags),
                     ("loans", loans), ("repayments", repayments)]:
        df.to_sql(name, con, index=False)
    con.executescript("""
    CREATE INDEX idx_txn_customer ON transactions(customer_id);
    CREATE INDEX idx_loan_customer ON loans(customer_id);
    CREATE INDEX idx_repay_loan ON repayments(loan_id);
    CREATE VIEW vw_monthly_kpis AS
        SELECT strftime('%Y-%m', txn_date) AS month,
               COUNT(*) AS txn_count,
               ROUND(SUM(amount_ksh), 2) AS total_value_ksh,
               ROUND(100.0 * SUM(status = 'Success') / COUNT(*), 2) AS success_rate_pct,
               COUNT(DISTINCT customer_id) AS active_customers
        FROM fact_transactions GROUP BY strftime('%Y-%m', txn_date);
    CREATE VIEW vw_loan_portfolio AS
        SELECT product, COUNT(*) AS loans, SUM(principal_ksh) AS principal_ksh,
               SUM(status = 'Defaulted') AS defaults,
               ROUND(100.0 * SUM(status = 'Defaulted') / COUNT(*), 2) AS default_rate_pct
        FROM loans GROUP BY product;
    CREATE VIEW vw_customer_360 AS
        SELECT c.customer_id, c.county, c.segment, c.monthly_income_ksh,
               (SELECT COUNT(*) FROM transactions t WHERE t.customer_id = c.customer_id) AS txns,
               (SELECT COUNT(*) FROM loans l WHERE l.customer_id = c.customer_id) AS loans
        FROM customers c;
    """)
    con.commit()
    con.close()
    return path


if __name__ == "__main__":
    print(build_fintech_db())
