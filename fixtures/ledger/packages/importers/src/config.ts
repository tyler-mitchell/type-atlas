import ledgerConfig from "../../../ledger.config.json" with { type: "json" };

/** The account unmatched statement lines land in until a bookkeeper files them. */
export const suspenseAccount: string = ledgerConfig.suspenseAccount;

/** The currency a bank export is assumed to use when it does not say. */
export const defaultCurrencyCode: string = ledgerConfig.defaultCurrency;
