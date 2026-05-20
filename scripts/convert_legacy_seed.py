from pathlib import Path
import re


def parse_row_values(row_text):
    values = []
    i = 0
    n = len(row_text)
    while i < n:
        if row_text[i].isspace() or row_text[i] == ',':
            i += 1
            continue
        if row_text.startswith('NULL', i):
            values.append(None)
            i += 4
            continue
        if row_text[i] == "'":
            i += 1
            s = []
            while i < n:
                if row_text[i] == "\\" and i + 1 < n:
                    s.append(row_text[i + 1])
                    i += 2
                    continue
                if row_text[i] == "'":
                    if i + 1 < n and row_text[i + 1] == "'":
                        s.append("'")
                        i += 2
                        continue
                    else:
                        i += 1
                        break
                s.append(row_text[i])
                i += 1
            values.append(''.join(s))
            continue
        m = re.match(r"[-+]?[0-9]*\.?[0-9]+([eE][-+]?[0-9]+)?", row_text[i:])
        if m:
            values.append(m.group(0))
            i += len(m.group(0))
            continue
        j = i
        while j < n and row_text[j] not in ',':
            j += 1
        values.append(row_text[i:j].strip())
        i = j
    return values


def rows_from_insert(sql_text, table_name):
    pattern = re.compile(rf'INSERT INTO `?{re.escape(table_name)}`? \([^\)]+\) VALUES\n(.*?);', re.S)
    rows = []
    for match in pattern.finditer(sql_text):
        block = match.group(1).strip()
        parts = re.split(r'\),\n', block)
        for part in parts:
            part = part.strip()
            if part.endswith('),'):
                part = part[:-2].strip()
            if part.startswith('(') and part.endswith(')'):
                part = part[1:-1].strip()
            if not part:
                continue
            rows.append(parse_row_values(part))
    return rows


def sql_string(val):
    if val is None:
        return 'NULL'
    return "'" + str(val).replace("'", "''") + "'"


def normalize_member_id(value, fallback_id):
    raw = str(value or "").strip().upper().replace(" ", "")
    if raw.startswith("SBC"):
        raw = raw.replace("O", "0")
    if not raw:
        raw = str(fallback_id or "").strip()
    digits = "".join(ch for ch in raw if ch.isdigit())
    if digits:
        return f"SBC{digits.zfill(4)}K"
    return raw or f"LEGACY-{fallback_id}"


def normalize_account_ref(value):
    raw = str(value or "").strip().upper().replace(" ", "")
    if raw.startswith("SBC"):
        raw = raw.replace("O", "0")
    return raw


def timestamp_expr(value):
    if value and re.match(r"\d{14}$", str(value)):
        return f"pg_temp.legacy_mpesa_timestamp('{value}')"
    if value:
        return f"to_timestamp({sql_string(value)}, 'YYYY-MM-DD HH24:MI:SS')"
    return "now()"


def values_table(rows, column_names):
    lines = []
    for idx, values in enumerate(rows):
        suffix = "," if idx != len(rows) - 1 else ""
        lines.append("  (" + ", ".join(values) + ")" + suffix)
    return "values\n" + "\n".join(lines)


client_seed_path = Path('supabase/seeds/client_list.sql')
api_seed_path = Path('supabase/seeds/api_topups.sql')

client_text = client_seed_path.read_text(encoding='utf-8')
api_text = api_seed_path.read_text(encoding='utf-8')
client_rows = rows_from_insert(client_text, 'client_list')
auto_rows = rows_from_insert(api_text, 'api_topups')

if not client_rows or not auto_rows:
    raise SystemExit(
        "Expected raw MySQL INSERT exports for client_list and api_topups. "
        "Refusing to overwrite converted seed files."
    )

member_value_rows = []
for row in client_rows:
    (client_id, membership_no, firstname, middlename, lastname, contact, email, address, ward_id,
     business_type_id, subcat_id, gender, btrandingname, password, delete_flag, created_at,
     date_updated, deleted_at) = row
    if deleted_at:
        continue
    member_id = normalize_member_id(membership_no, client_id)
    name = firstname or ''
    if middlename:
        name = f"{name} {middlename}"
    if lastname:
        name = f"{name} {lastname}"
    name = name.strip() or 'Unknown Member'
    phone = contact if contact else 'unknown'
    joined_at = created_at[:10] if created_at else None
    status = 'active'
    business_type = str(business_type_id) if business_type_id is not None else None
    old_system_id = membership_no if membership_no else str(client_id)
    updated_at = date_updated if date_updated else created_at
    member_value_rows.append([
        sql_string(member_id), sql_string(name), sql_string(phone), sql_string(joined_at),
        sql_string(status), sql_string(firstname), sql_string(middlename), sql_string(lastname),
        sql_string(gender), sql_string(email), sql_string(address), sql_string(btrandingname),
        sql_string(business_type), sql_string(address), sql_string(old_system_id),
        timestamp_expr(created_at), timestamp_expr(updated_at)
    ])

event_value_rows = []
for row in auto_rows:
    (idv, transaction_type, transid, transtime, transamount, business_shortcode, bill_ref,
     invoice_number, org_balance, third_party, msisdn, firstname, middlename, lastname,
     created_at, updated_at, deleted_at) = row
    if deleted_at or not transid:
        continue
    payer_name = ' '.join([p for p in [firstname, middlename, lastname] if p]) or None
    account = normalize_account_ref(bill_ref)
    created_at_expr = timestamp_expr(transtime or created_at)
    raw_pairs = [
        ('TransactionType', transaction_type), ('TransID', transid), ('TransTime', transtime),
        ('TransAmount', transamount), ('BusinessShortCode', business_shortcode),
        ('BillRefNumber', bill_ref), ('InvoiceNumber', invoice_number),
        ('OrgAccountBalance', org_balance), ('ThirdPartyTransID', third_party),
        ('MSISDN', msisdn), ('FirstName', firstname), ('MiddleName', middlename),
        ('LastName', lastname), ('created_at', created_at), ('updated_at', updated_at),
        ('deleted_at', deleted_at)
    ]
    raw_sql = 'jsonb_build_object(' + ', '.join(f"'{k}', {sql_string(v)}" for k, v in raw_pairs) + ')'
    event_value_rows.append([
        sql_string(account), sql_string(msisdn), 'NULL' if transamount is None else str(transamount),
        sql_string(transid), sql_string(payer_name), raw_sql, created_at_expr
    ])

member_sql = [
    "-- Legacy client_list seed mapped into public.members.",
    "-- Generated from the MySQL export by scripts/convert_legacy_seed.py.",
    "begin;",
    "",
    "with legacy_members(id, name, phone, joined_at, status, first_name, second_name, third_name, gender, email, address, business_name, business_type, business_address, old_system_id, created_at, updated_at) as (",
    values_table(member_value_rows, []),
    ")",
    "insert into public.members (",
    "  id, name, phone, joined_at, status, first_name, second_name, third_name, gender, email, address,",
    "  business_name, business_type, business_address, old_system_id, member_category, created_at, updated_at",
    ")",
    "select",
    "  id, name, phone, joined_at::date, status::public.member_status, first_name, second_name, third_name,",
    "  nullif(gender, ''), nullif(email, ''), nullif(address, ''), nullif(business_name, ''),",
    "  nullif(business_type, ''), nullif(business_address, ''), nullif(old_system_id, ''),",
    "  'member'::public.member_category, created_at, updated_at",
    "from legacy_members",
    "on conflict (id) do update set",
    "  name = excluded.name,",
    "  phone = excluded.phone,",
    "  first_name = excluded.first_name,",
    "  second_name = excluded.second_name,",
    "  third_name = excluded.third_name,",
    "  gender = excluded.gender,",
    "  email = excluded.email,",
    "  address = excluded.address,",
    "  business_name = excluded.business_name,",
    "  business_type = excluded.business_type,",
    "  business_address = excluded.business_address,",
    "  old_system_id = excluded.old_system_id,",
    "  updated_at = excluded.updated_at;",
    "",
    "commit;",
]

event_sql = [
    "-- Legacy api_topups seed mapped into public.mpesa_events.",
    "-- These are confirmed receipts. They remain unprocessed so the app's Mpesa allocator",
    "-- distributes them through the same fees/savings/shares/loan flow used by live callbacks.",
    "begin;",
    "",
    "create or replace function pg_temp.legacy_mpesa_timestamp(value text)",
    "returns timestamptz",
    "language sql",
    "immutable",
    "as $$",
    "  select make_timestamptz(",
    "    substring(value from 1 for 4)::int,",
    "    substring(value from 5 for 2)::int,",
    "    substring(value from 7 for 2)::int,",
    "    substring(value from 9 for 2)::int,",
    "    substring(value from 11 for 2)::int,",
    "    substring(value from 13 for 2)::double precision,",
    "    'Africa/Nairobi'",
    "  )",
    "  where value ~ '^\\d{14}$';",
    "$$;",
    "",
    "with legacy_mpesa(account, phone, amount, mpesa_ref, payer_name, raw, created_at) as (",
    values_table(event_value_rows, []),
    ")",
    "insert into public.mpesa_events (kind, account, phone, amount, mpesa_ref, payer_name, raw, processed, created_at)",
    "select 'confirmation', account, phone, amount::numeric, mpesa_ref, payer_name, raw, false, created_at",
    "from legacy_mpesa lm",
    "where not exists (",
    "  select 1 from public.mpesa_events existing",
    "  where existing.kind = 'confirmation'",
    "    and existing.mpesa_ref is not distinct from lm.mpesa_ref",
    ");",
    "",
    "commit;",
]

client_seed_path.write_text('\n'.join(member_sql) + '\n', encoding='utf-8')
api_seed_path.write_text('\n'.join(event_sql) + '\n', encoding='utf-8')
print('Converted client_list.sql to', len(member_value_rows), 'member seed rows')
print('Converted api_topups.sql to', len(event_value_rows), 'confirmed Mpesa seed events')
