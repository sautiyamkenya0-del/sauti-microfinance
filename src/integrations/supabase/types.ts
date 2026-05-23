export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5";
  };
  public: {
    Tables: {
      appraisals: {
        Row: {
          approved_amount: number | null;
          approved_term: string | null;
          average_day: number;
          bad_day: number;
          bdsr: number | null;
          crb_status: string | null;
          created_at: string;
          date: string;
          decision: string | null;
          dicr: number | null;
          dti: number | null;
          existing_debt: number;
          good_day: number;
          id: string;
          loan_id: string | null;
          lsr: number | null;
          member_id: string;
          monthly_debt_repayment: number;
          non_earning_days: number;
          notes: string | null;
          officer_id: string | null;
          operating_expenses: number;
          reschedules_last_12: number;
          risk_level: string | null;
          savings_buffer: number | null;
          score_bdsr: number | null;
          score_burden: number | null;
          score_coop: number | null;
          score_crb: number | null;
          score_dicr: number | null;
          score_docs: number | null;
          score_savings: number | null;
          special_conditions: string | null;
          total_score: number | null;
        };
        Insert: {
          approved_amount?: number | null;
          approved_term?: string | null;
          average_day?: number;
          bad_day?: number;
          bdsr?: number | null;
          crb_status?: string | null;
          created_at?: string;
          date?: string;
          decision?: string | null;
          dicr?: number | null;
          dti?: number | null;
          existing_debt?: number;
          good_day?: number;
          id: string;
          loan_id?: string | null;
          lsr?: number | null;
          member_id: string;
          monthly_debt_repayment?: number;
          non_earning_days?: number;
          notes?: string | null;
          officer_id?: string | null;
          operating_expenses?: number;
          reschedules_last_12?: number;
          risk_level?: string | null;
          savings_buffer?: number | null;
          score_bdsr?: number | null;
          score_burden?: number | null;
          score_coop?: number | null;
          score_crb?: number | null;
          score_dicr?: number | null;
          score_docs?: number | null;
          score_savings?: number | null;
          special_conditions?: string | null;
          total_score?: number | null;
        };
        Update: {
          approved_amount?: number | null;
          approved_term?: string | null;
          average_day?: number;
          bad_day?: number;
          bdsr?: number | null;
          crb_status?: string | null;
          created_at?: string;
          date?: string;
          decision?: string | null;
          dicr?: number | null;
          dti?: number | null;
          existing_debt?: number;
          good_day?: number;
          id?: string;
          loan_id?: string | null;
          lsr?: number | null;
          member_id?: string;
          monthly_debt_repayment?: number;
          non_earning_days?: number;
          notes?: string | null;
          officer_id?: string | null;
          operating_expenses?: number;
          reschedules_last_12?: number;
          risk_level?: string | null;
          savings_buffer?: number | null;
          score_bdsr?: number | null;
          score_burden?: number | null;
          score_coop?: number | null;
          score_crb?: number | null;
          score_dicr?: number | null;
          score_docs?: number | null;
          score_savings?: number | null;
          special_conditions?: string | null;
          total_score?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "appraisals_loan_id_fkey";
            columns: ["loan_id"];
            isOneToOne: false;
            referencedRelation: "loans";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "appraisals_member_id_fkey";
            columns: ["member_id"];
            isOneToOne: false;
            referencedRelation: "members";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "appraisals_officer_id_fkey";
            columns: ["officer_id"];
            isOneToOne: false;
            referencedRelation: "staff";
            referencedColumns: ["id"];
          },
        ];
      };
      attendance: {
        Row: {
          check_in: string | null;
          check_out: string | null;
          created_at: string;
          date: string;
          id: string;
          staff_id: string;
          status: Database["public"]["Enums"]["attendance_status"];
        };
        Insert: {
          check_in?: string | null;
          check_out?: string | null;
          created_at?: string;
          date: string;
          id: string;
          staff_id: string;
          status: Database["public"]["Enums"]["attendance_status"];
        };
        Update: {
          check_in?: string | null;
          check_out?: string | null;
          created_at?: string;
          date?: string;
          id?: string;
          staff_id?: string;
          status?: Database["public"]["Enums"]["attendance_status"];
        };
        Relationships: [
          {
            foreignKeyName: "attendance_staff_id_fkey";
            columns: ["staff_id"];
            isOneToOne: false;
            referencedRelation: "staff";
            referencedColumns: ["id"];
          },
        ];
      };
      audit_log: {
        Row: {
          action: string;
          actor_id: string | null;
          actor_name: string | null;
          actor_role: string | null;
          details: Json | null;
          id: string;
          ip: string | null;
          summary: string;
          target_id: string | null;
          target_type: string | null;
          ts: string;
          user_agent: string | null;
        };
        Insert: {
          action: string;
          actor_id?: string | null;
          actor_name?: string | null;
          actor_role?: string | null;
          details?: Json | null;
          id?: string;
          ip?: string | null;
          summary: string;
          target_id?: string | null;
          target_type?: string | null;
          ts?: string;
          user_agent?: string | null;
        };
        Update: {
          action?: string;
          actor_id?: string | null;
          actor_name?: string | null;
          actor_role?: string | null;
          details?: Json | null;
          id?: string;
          ip?: string | null;
          summary?: string;
          target_id?: string | null;
          target_type?: string | null;
          ts?: string;
          user_agent?: string | null;
        };
        Relationships: [];
      };
      field_visits: {
        Row: {
          by_staff: string | null;
          created_at: string;
          date: string;
          id: string;
          lat: number | null;
          lng: number | null;
          location_notes: string | null;
          member_id: string;
          photos: string[] | null;
          photo_labels: string[] | null;
          type: Database["public"]["Enums"]["field_visit_type"];
        };
        Insert: {
          by_staff?: string | null;
          created_at?: string;
          date?: string;
          id: string;
          lat?: number | null;
          lng?: number | null;
          location_notes?: string | null;
          member_id: string;
          photos?: string[] | null;
          photo_labels?: string[] | null;
          type: Database["public"]["Enums"]["field_visit_type"];
        };
        Update: {
          by_staff?: string | null;
          created_at?: string;
          date?: string;
          id?: string;
          lat?: number | null;
          lng?: number | null;
          location_notes?: string | null;
          member_id?: string;
          photos?: string[] | null;
          photo_labels?: string[] | null;
          type?: Database["public"]["Enums"]["field_visit_type"];
        };
        Relationships: [
          {
            foreignKeyName: "field_visits_by_staff_fkey";
            columns: ["by_staff"];
            isOneToOne: false;
            referencedRelation: "staff";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "field_visits_member_id_fkey";
            columns: ["member_id"];
            isOneToOne: false;
            referencedRelation: "members";
            referencedColumns: ["id"];
          },
        ];
      };
      followups: {
        Row: {
          by_staff: string | null;
          created_at: string;
          date: string;
          id: string;
          loan_id: string;
          member_id: string;
          note: string;
          outcome: Database["public"]["Enums"]["followup_outcome"];
        };
        Insert: {
          by_staff?: string | null;
          created_at?: string;
          date?: string;
          id: string;
          loan_id: string;
          member_id: string;
          note: string;
          outcome: Database["public"]["Enums"]["followup_outcome"];
        };
        Update: {
          by_staff?: string | null;
          created_at?: string;
          date?: string;
          id?: string;
          loan_id?: string;
          member_id?: string;
          note?: string;
          outcome?: Database["public"]["Enums"]["followup_outcome"];
        };
        Relationships: [
          {
            foreignKeyName: "followups_by_staff_fkey";
            columns: ["by_staff"];
            isOneToOne: false;
            referencedRelation: "staff";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "followups_loan_id_fkey";
            columns: ["loan_id"];
            isOneToOne: false;
            referencedRelation: "loans";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "followups_member_id_fkey";
            columns: ["member_id"];
            isOneToOne: false;
            referencedRelation: "members";
            referencedColumns: ["id"];
          },
        ];
      };
      idempotency_keys: {
        Row: {
          created_at: string;
          key: string;
          result: Json | null;
          scope: string;
        };
        Insert: {
          created_at?: string;
          key: string;
          result?: Json | null;
          scope: string;
        };
        Update: {
          created_at?: string;
          key?: string;
          result?: Json | null;
          scope?: string;
        };
        Relationships: [];
      };
      investors: {
        Row: {
          contributed: number;
          created_at: string;
          id: string;
          joined_at: string;
          member_id: string | null;
          name: string;
          notes: string | null;
          phone: string | null;
          share_pct: number;
        };
        Insert: {
          contributed?: number;
          created_at?: string;
          id: string;
          joined_at?: string;
          member_id?: string | null;
          name: string;
          notes?: string | null;
          phone?: string | null;
          share_pct?: number;
        };
        Update: {
          contributed?: number;
          created_at?: string;
          id?: string;
          joined_at?: string;
          member_id?: string | null;
          name?: string;
          notes?: string | null;
          phone?: string | null;
          share_pct?: number;
        };
        Relationships: [
          {
            foreignKeyName: "investors_member_id_fkey";
            columns: ["member_id"];
            isOneToOne: false;
            referencedRelation: "members";
            referencedColumns: ["id"];
          },
        ];
      };
      loans: {
        Row: {
          approved_amount: number | null;
          created_at: string;
          id: string;
          member_id: string;
          officer_id: string | null;
          paid: number;
          principal: number;
          purpose: string | null;
          rate: number;
          review_note: string | null;
          reviewed_by: string | null;
          start_date: string;
          status: Database["public"]["Enums"]["loan_status"];
          term_days: number | null;
          term_months: number;
          updated_at: string;
        };
        Insert: {
          approved_amount?: number | null;
          created_at?: string;
          id: string;
          member_id: string;
          officer_id?: string | null;
          paid?: number;
          principal: number;
          purpose?: string | null;
          rate?: number;
          review_note?: string | null;
          reviewed_by?: string | null;
          start_date?: string;
          status?: Database["public"]["Enums"]["loan_status"];
          term_days?: number | null;
          term_months?: number;
          updated_at?: string;
        };
        Update: {
          approved_amount?: number | null;
          created_at?: string;
          id?: string;
          member_id?: string;
          officer_id?: string | null;
          paid?: number;
          principal?: number;
          purpose?: string | null;
          rate?: number;
          review_note?: string | null;
          reviewed_by?: string | null;
          start_date?: string;
          status?: Database["public"]["Enums"]["loan_status"];
          term_days?: number | null;
          term_months?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "loans_member_id_fkey";
            columns: ["member_id"];
            isOneToOne: false;
            referencedRelation: "members";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "loans_officer_id_fkey";
            columns: ["officer_id"];
            isOneToOne: false;
            referencedRelation: "staff";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "loans_reviewed_by_fkey";
            columns: ["reviewed_by"];
            isOneToOne: false;
            referencedRelation: "staff";
            referencedColumns: ["id"];
          },
        ];
      };
      members: {
        Row: {
          address: string | null;
          business_address: string | null;
          business_name: string | null;
          business_permanence: Database["public"]["Enums"]["business_permanence"] | null;
          business_type: string | null;
          city: string | null;
          county: string | null;
          created_at: string;
          dob: string | null;
          email: string | null;
          fee_card: boolean;
          fee_first_upfront_paid: boolean;
          fee_has_shop: boolean;
          fee_membership: boolean;
          fee_sticker: boolean;
          field_officer_id: string | null;
          first_name: string | null;
          gender: string | null;
          id: string;
          investor_id: string | null;
          is_investor: boolean;
          joined_at: string;
          last_name: string | null;
          member_category: Database["public"]["Enums"]["member_category"];
          name: string;
          old_system_id: string | null;
          phone: string;
          savings_balance: number;
          savings_only: boolean;
          second_name: string | null;
          share_reserve_balance: number;
          shares: number;
          status: Database["public"]["Enums"]["member_status"];
          third_name: string | null;
          updated_at: string;
          village: string | null;
        };
        Insert: {
          address?: string | null;
          business_address?: string | null;
          business_name?: string | null;
          business_permanence?: Database["public"]["Enums"]["business_permanence"] | null;
          business_type?: string | null;
          city?: string | null;
          county?: string | null;
          created_at?: string;
          dob?: string | null;
          email?: string | null;
          fee_card?: boolean;
          fee_first_upfront_paid?: boolean;
          fee_has_shop?: boolean;
          fee_membership?: boolean;
          fee_sticker?: boolean;
          field_officer_id?: string | null;
          first_name?: string | null;
          gender?: string | null;
          id: string;
          investor_id?: string | null;
          is_investor?: boolean;
          joined_at?: string;
          last_name?: string | null;
          member_category?: Database["public"]["Enums"]["member_category"];
          name: string;
          old_system_id?: string | null;
          phone: string;
          savings_balance?: number;
          savings_only?: boolean;
          second_name?: string | null;
          share_reserve_balance?: number;
          shares?: number;
          status?: Database["public"]["Enums"]["member_status"];
          third_name?: string | null;
          updated_at?: string;
          village?: string | null;
        };
        Update: {
          address?: string | null;
          business_address?: string | null;
          business_name?: string | null;
          business_permanence?: Database["public"]["Enums"]["business_permanence"] | null;
          business_type?: string | null;
          city?: string | null;
          county?: string | null;
          created_at?: string;
          dob?: string | null;
          email?: string | null;
          fee_card?: boolean;
          fee_first_upfront_paid?: boolean;
          fee_has_shop?: boolean;
          fee_membership?: boolean;
          fee_sticker?: boolean;
          field_officer_id?: string | null;
          first_name?: string | null;
          gender?: string | null;
          id?: string;
          investor_id?: string | null;
          is_investor?: boolean;
          joined_at?: string;
          last_name?: string | null;
          member_category?: Database["public"]["Enums"]["member_category"];
          name?: string;
          old_system_id?: string | null;
          phone?: string;
          savings_balance?: number;
          savings_only?: boolean;
          second_name?: string | null;
          share_reserve_balance?: number;
          shares?: number;
          status?: Database["public"]["Enums"]["member_status"];
          third_name?: string | null;
          updated_at?: string;
          village?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "members_field_officer_id_fkey";
            columns: ["field_officer_id"];
            isOneToOne: false;
            referencedRelation: "staff";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "members_investor_fk";
            columns: ["investor_id"];
            isOneToOne: false;
            referencedRelation: "investors";
            referencedColumns: ["id"];
          },
        ];
      };
      mpesa_events: {
        Row: {
          account: string | null;
          amount: number | null;
          created_at: string;
          id: string;
          kind: string;
          mpesa_ref: string | null;
          payer_name: string | null;
          phone: string | null;
          processed: boolean;
          raw: Json;
          transaction_id: string | null;
        };
        Insert: {
          account?: string | null;
          amount?: number | null;
          created_at?: string;
          id?: string;
          kind: string;
          mpesa_ref?: string | null;
          payer_name?: string | null;
          phone?: string | null;
          processed?: boolean;
          raw: Json;
          transaction_id?: string | null;
        };
        Update: {
          account?: string | null;
          amount?: number | null;
          created_at?: string;
          id?: string;
          kind?: string;
          mpesa_ref?: string | null;
          payer_name?: string | null;
          phone?: string | null;
          processed?: boolean;
          raw?: Json;
          transaction_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "mpesa_events_transaction_id_fkey";
            columns: ["transaction_id"];
            isOneToOne: false;
            referencedRelation: "transactions";
            referencedColumns: ["id"];
          },
        ];
      };
      penalties: {
        Row: {
          amount: number;
          created_at: string;
          date: string;
          id: string;
          loan_id: string | null;
          member_id: string;
          paid_from: Database["public"]["Enums"]["penalty_source"] | null;
          reason: string;
          status: Database["public"]["Enums"]["penalty_status"];
        };
        Insert: {
          amount: number;
          created_at?: string;
          date?: string;
          id: string;
          loan_id?: string | null;
          member_id: string;
          paid_from?: Database["public"]["Enums"]["penalty_source"] | null;
          reason: string;
          status?: Database["public"]["Enums"]["penalty_status"];
        };
        Update: {
          amount?: number;
          created_at?: string;
          date?: string;
          id?: string;
          loan_id?: string | null;
          member_id?: string;
          paid_from?: Database["public"]["Enums"]["penalty_source"] | null;
          reason?: string;
          status?: Database["public"]["Enums"]["penalty_status"];
        };
        Relationships: [
          {
            foreignKeyName: "penalties_loan_id_fkey";
            columns: ["loan_id"];
            isOneToOne: false;
            referencedRelation: "loans";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "penalties_member_id_fkey";
            columns: ["member_id"];
            isOneToOne: false;
            referencedRelation: "members";
            referencedColumns: ["id"];
          },
        ];
      };
      petty_cash: {
        Row: {
          amount: number;
          by_staff: string | null;
          category: string | null;
          contact: string | null;
          created_at: string;
          date: string;
          description: string;
          id: string;
          mode: Database["public"]["Enums"]["payment_mode"] | null;
          opening_balance: number | null;
          payee: string | null;
          reference: string | null;
          time: string | null;
          txn_cost: number | null;
          type: Database["public"]["Enums"]["petty_type"] | null;
        };
        Insert: {
          amount: number;
          by_staff?: string | null;
          category?: string | null;
          contact?: string | null;
          created_at?: string;
          date?: string;
          description: string;
          id: string;
          mode?: Database["public"]["Enums"]["payment_mode"] | null;
          opening_balance?: number | null;
          payee?: string | null;
          reference?: string | null;
          time?: string | null;
          txn_cost?: number | null;
          type?: Database["public"]["Enums"]["petty_type"] | null;
        };
        Update: {
          amount?: number;
          by_staff?: string | null;
          category?: string | null;
          contact?: string | null;
          created_at?: string;
          date?: string;
          description?: string;
          id?: string;
          mode?: Database["public"]["Enums"]["payment_mode"] | null;
          opening_balance?: number | null;
          payee?: string | null;
          reference?: string | null;
          time?: string | null;
          txn_cost?: number | null;
          type?: Database["public"]["Enums"]["petty_type"] | null;
        };
        Relationships: [
          {
            foreignKeyName: "petty_cash_by_staff_fkey";
            columns: ["by_staff"];
            isOneToOne: false;
            referencedRelation: "staff";
            referencedColumns: ["id"];
          },
        ];
      };
      round_off: {
        Row: {
          amount: number;
          created_at: string;
          date: string;
          id: string;
          member_id: string;
          ref: string | null;
          source: Database["public"]["Enums"]["roundoff_source"];
        };
        Insert: {
          amount: number;
          created_at?: string;
          date?: string;
          id: string;
          member_id: string;
          ref?: string | null;
          source: Database["public"]["Enums"]["roundoff_source"];
        };
        Update: {
          amount?: number;
          created_at?: string;
          date?: string;
          id?: string;
          member_id?: string;
          ref?: string | null;
          source?: Database["public"]["Enums"]["roundoff_source"];
        };
        Relationships: [
          {
            foreignKeyName: "round_off_member_id_fkey";
            columns: ["member_id"];
            isOneToOne: false;
            referencedRelation: "members";
            referencedColumns: ["id"];
          },
        ];
      };
      runtime_secrets: {
        Row: {
          key: string;
          updated_at: string;
          value: string;
        };
        Insert: {
          key: string;
          updated_at?: string;
          value: string;
        };
        Update: {
          key?: string;
          updated_at?: string;
          value?: string;
        };
        Relationships: [];
      };
      staff: {
        Row: {
          address: string | null;
          can_mark_attendance: boolean;
          created_at: string;
          email: string | null;
          fingerprint_enrolled: boolean;
          id: string;
          name: string;
          national_id: string | null;
          notes: string | null;
          phone: string | null;
          photo: string | null;
          role: Database["public"]["Enums"]["staff_role"];
          temp_password: string | null;
          updated_at: string;
        };
        Insert: {
          address?: string | null;
          can_mark_attendance?: boolean;
          created_at?: string;
          email?: string | null;
          fingerprint_enrolled?: boolean;
          id: string;
          name: string;
          national_id?: string | null;
          notes?: string | null;
          phone?: string | null;
          photo?: string | null;
          role: Database["public"]["Enums"]["staff_role"];
          temp_password?: string | null;
          updated_at?: string;
        };
        Update: {
          address?: string | null;
          can_mark_attendance?: boolean;
          created_at?: string;
          email?: string | null;
          fingerprint_enrolled?: boolean;
          id?: string;
          name?: string;
          national_id?: string | null;
          notes?: string | null;
          phone?: string | null;
          photo?: string | null;
          role?: Database["public"]["Enums"]["staff_role"];
          temp_password?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      transactions: {
        Row: {
          account: string | null;
          amount: number;
          by_staff: string | null;
          created_at: string;
          date: string;
          id: string;
          loan_id: string | null;
          member_id: string | null;
          note: string | null;
          payer_name: string | null;
          ref: string | null;
          type: Database["public"]["Enums"]["tx_type"];
        };
        Insert: {
          account?: string | null;
          amount: number;
          by_staff?: string | null;
          created_at?: string;
          date?: string;
          id: string;
          loan_id?: string | null;
          member_id?: string | null;
          note?: string | null;
          payer_name?: string | null;
          ref?: string | null;
          type: Database["public"]["Enums"]["tx_type"];
        };
        Update: {
          account?: string | null;
          amount?: number;
          by_staff?: string | null;
          created_at?: string;
          date?: string;
          id?: string;
          loan_id?: string | null;
          member_id?: string | null;
          note?: string | null;
          payer_name?: string | null;
          ref?: string | null;
          type?: Database["public"]["Enums"]["tx_type"];
        };
        Relationships: [
          {
            foreignKeyName: "transactions_by_staff_fkey";
            columns: ["by_staff"];
            isOneToOne: false;
            referencedRelation: "staff";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "transactions_loan_id_fkey";
            columns: ["loan_id"];
            isOneToOne: false;
            referencedRelation: "loans";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "transactions_member_id_fkey";
            columns: ["member_id"];
            isOneToOne: false;
            referencedRelation: "members";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      [_ in never]: never;
    };
    Enums: {
      attendance_status: "present" | "absent" | "late" | "signed_out" | "permission";
      business_permanence: "permanent" | "semi";
      field_visit_type: "business" | "home" | "live";
      followup_outcome: "promised" | "paid" | "no-show" | "dispute" | "other";
      loan_status: "pending" | "active" | "closed" | "defaulted" | "rejected";
      member_category: "member" | "investor" | "both" | "locomotive" | "stock" | "service";
      member_status: "active" | "dormant";
      payment_mode: "cash" | "mpesa" | "bank";
      penalty_source: "round_off_pool" | "direct" | "mpesa";
      penalty_status: "outstanding" | "paid";
      petty_type: "payment" | "topup";
      roundoff_source: "loan_repayment" | "savings_deposit" | "share_purchase" | "manual";
      staff_role: "director" | "manager" | "loan_officer";
      tx_type:
        | "deposit"
        | "withdrawal"
        | "loan_disbursement"
        | "loan_repayment"
        | "share_purchase"
        | "petty_cash"
        | "investor_contribution"
        | "fee_payment"
        | "mpesa_unallocated";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      attendance_status: ["present", "absent", "late", "signed_out", "permission"],
      business_permanence: ["permanent", "semi"],
      field_visit_type: ["business", "home", "live"],
      followup_outcome: ["promised", "paid", "no-show", "dispute", "other"],
      loan_status: ["pending", "active", "closed", "defaulted", "rejected"],
      member_category: ["member", "investor", "both", "locomotive", "stock", "service"],
      member_status: ["active", "dormant"],
      payment_mode: ["cash", "mpesa", "bank"],
      penalty_source: ["round_off_pool", "direct", "mpesa"],
      penalty_status: ["outstanding", "paid"],
      petty_type: ["payment", "topup"],
      roundoff_source: ["loan_repayment", "savings_deposit", "share_purchase", "manual"],
      staff_role: ["director", "manager", "loan_officer"],
      tx_type: [
        "deposit",
        "withdrawal",
        "loan_disbursement",
        "loan_repayment",
        "share_purchase",
        "petty_cash",
        "investor_contribution",
        "fee_payment",
        "mpesa_unallocated",
      ],
    },
  },
} as const;
