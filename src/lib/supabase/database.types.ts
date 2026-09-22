export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      asset_types: {
        Row: {
          active: boolean
          cluster: string
          created_at: string
          id: string
          name: string
        }
        Insert: {
          active?: boolean
          cluster: string
          created_at?: string
          id?: string
          name: string
        }
        Update: {
          active?: boolean
          cluster?: string
          created_at?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
      companies: {
        Row: {
          address: string | null
          admin_name: string | null
          cif: string
          cnae: string | null
          constitution_date: string | null
          country: string
          created_at: string
          email: string | null
          employees: number | null
          id: string
          name: string
          phone: string | null
          sector: string | null
          updated_at: string
          web: string | null
        }
        Insert: {
          address?: string | null
          admin_name?: string | null
          cif: string
          cnae?: string | null
          constitution_date?: string | null
          country?: string
          created_at?: string
          email?: string | null
          employees?: number | null
          id?: string
          name: string
          phone?: string | null
          sector?: string | null
          updated_at?: string
          web?: string | null
        }
        Update: {
          address?: string | null
          admin_name?: string | null
          cif?: string
          cnae?: string | null
          constitution_date?: string | null
          country?: string
          created_at?: string
          email?: string | null
          employees?: number | null
          id?: string
          name?: string
          phone?: string | null
          sector?: string | null
          updated_at?: string
          web?: string | null
        }
        Relationships: []
      }
      contract_assets: {
        Row: {
          asset_type_id: string
          contract_id: string
          description: string | null
          id: string
          quantity: number
          unit_cost: number | null
        }
        Insert: {
          asset_type_id: string
          contract_id: string
          description?: string | null
          id?: string
          quantity?: number
          unit_cost?: number | null
        }
        Update: {
          asset_type_id?: string
          contract_id?: string
          description?: string | null
          id?: string
          quantity?: number
          unit_cost?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "contract_assets_asset_type_id_fkey"
            columns: ["asset_type_id"]
            isOneToOne: false
            referencedRelation: "asset_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contract_assets_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
        ]
      }
      contract_types: {
        Row: {
          billing_lag_months: number
          code: string
          label: string
        }
        Insert: {
          billing_lag_months?: number
          code: string
          label: string
        }
        Update: {
          billing_lag_months?: number
          code?: string
          label?: string
        }
        Relationships: []
      }
      contracts: {
        Row: {
          additional_status: string | null
          amortize_over_real_life: boolean
          asset_type_id: string | null
          cancel_date: string | null
          company_id: string
          contract_number: string
          contract_type: string
          created_at: string
          distributor_id: string | null
          duration_months: number
          expo_adjustment: number
          guarantor_name: string | null
          guarantor_nif: string | null
          has_guarantor: boolean
          id: string
          installment: number
          loan_book_ref: string | null
          notes: string | null
          product_type: string | null
          purchase_value: number
          rating: string | null
          residual_value: number | null
          residual_waived: boolean
          scoring_id: string | null
          sector: string | null
          signing_date: string
          tranche_lender: string | null
          updated_at: string
          workflow_status: Database["public"]["Enums"]["contract_workflow_status"]
        }
        Insert: {
          additional_status?: string | null
          amortize_over_real_life?: boolean
          asset_type_id?: string | null
          cancel_date?: string | null
          company_id: string
          contract_number?: string
          contract_type: string
          created_at?: string
          distributor_id?: string | null
          duration_months: number
          expo_adjustment?: number
          guarantor_name?: string | null
          guarantor_nif?: string | null
          has_guarantor?: boolean
          id?: string
          installment: number
          loan_book_ref?: string | null
          notes?: string | null
          product_type?: string | null
          purchase_value: number
          rating?: string | null
          residual_value?: number | null
          residual_waived?: boolean
          scoring_id?: string | null
          sector?: string | null
          signing_date: string
          tranche_lender?: string | null
          updated_at?: string
          workflow_status?: Database["public"]["Enums"]["contract_workflow_status"]
        }
        Update: {
          additional_status?: string | null
          amortize_over_real_life?: boolean
          asset_type_id?: string | null
          cancel_date?: string | null
          company_id?: string
          contract_number?: string
          contract_type?: string
          created_at?: string
          distributor_id?: string | null
          duration_months?: number
          expo_adjustment?: number
          guarantor_name?: string | null
          guarantor_nif?: string | null
          has_guarantor?: boolean
          id?: string
          installment?: number
          loan_book_ref?: string | null
          notes?: string | null
          product_type?: string | null
          purchase_value?: number
          rating?: string | null
          residual_value?: number | null
          residual_waived?: boolean
          scoring_id?: string | null
          sector?: string | null
          signing_date?: string
          tranche_lender?: string | null
          updated_at?: string
          workflow_status?: Database["public"]["Enums"]["contract_workflow_status"]
        }
        Relationships: [
          {
            foreignKeyName: "contracts_asset_type_id_fkey"
            columns: ["asset_type_id"]
            isOneToOne: false
            referencedRelation: "asset_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contracts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contracts_contract_type_fkey"
            columns: ["contract_type"]
            isOneToOne: false
            referencedRelation: "contract_types"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "contracts_distributor_id_fkey"
            columns: ["distributor_id"]
            isOneToOne: false
            referencedRelation: "distributors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contracts_scoring_id_fkey"
            columns: ["scoring_id"]
            isOneToOne: false
            referencedRelation: "scorings"
            referencedColumns: ["id"]
          },
        ]
      }
      distributors: {
        Row: {
          active: boolean
          cif: string | null
          created_at: string
          email: string | null
          id: string
          name: string
        }
        Insert: {
          active?: boolean
          cif?: string | null
          created_at?: string
          email?: string | null
          id?: string
          name: string
        }
        Update: {
          active?: boolean
          cif?: string | null
          created_at?: string
          email?: string | null
          id?: string
          name?: string
        }
        Relationships: []
      }
      informa_reports: {
        Row: {
          company_id: string | null
          created_at: string
          file_name: string | null
          id: string
          parsed: Json
          reference_year: number | null
          source: Database["public"]["Enums"]["scoring_source"]
          storage_path: string | null
        }
        Insert: {
          company_id?: string | null
          created_at?: string
          file_name?: string | null
          id?: string
          parsed: Json
          reference_year?: number | null
          source: Database["public"]["Enums"]["scoring_source"]
          storage_path?: string | null
        }
        Update: {
          company_id?: string | null
          created_at?: string
          file_name?: string | null
          id?: string
          parsed?: Json
          reference_year?: number | null
          source?: Database["public"]["Enums"]["scoring_source"]
          storage_path?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "informa_reports_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      scoring_criteria: {
        Row: {
          config: Json
          created_at: string
          id: string
          is_active: boolean
          notes: string | null
          version: number
        }
        Insert: {
          config: Json
          created_at?: string
          id?: string
          is_active?: boolean
          notes?: string | null
          version: number
        }
        Update: {
          config?: Json
          created_at?: string
          id?: string
          is_active?: boolean
          notes?: string | null
          version?: number
        }
        Relationships: []
      }
      scorings: {
        Row: {
          adjusted_ebitda: number | null
          breakdown: Json
          company_id: string
          created_at: string
          credit_opinion: number
          criteria_id: string | null
          criteria_snapshot: Json
          decision: Database["public"]["Enums"]["scoring_decision"]
          financials: Json
          id: string
          informa_report_id: string | null
          prudence: number
          rating: Database["public"]["Enums"]["credit_rating"]
          ratios: Json
          review_note: string | null
          reviewed_at: string | null
          status: Database["public"]["Enums"]["scoring_status"]
          total_score: number
          updated_at: string
        }
        Insert: {
          adjusted_ebitda?: number | null
          breakdown: Json
          company_id: string
          created_at?: string
          credit_opinion: number
          criteria_id?: string | null
          criteria_snapshot: Json
          decision: Database["public"]["Enums"]["scoring_decision"]
          financials: Json
          id?: string
          informa_report_id?: string | null
          prudence: number
          rating: Database["public"]["Enums"]["credit_rating"]
          ratios: Json
          review_note?: string | null
          reviewed_at?: string | null
          status: Database["public"]["Enums"]["scoring_status"]
          total_score: number
          updated_at?: string
        }
        Update: {
          adjusted_ebitda?: number | null
          breakdown?: Json
          company_id?: string
          created_at?: string
          credit_opinion?: number
          criteria_id?: string | null
          criteria_snapshot?: Json
          decision?: Database["public"]["Enums"]["scoring_decision"]
          financials?: Json
          id?: string
          informa_report_id?: string | null
          prudence?: number
          rating?: Database["public"]["Enums"]["credit_rating"]
          ratios?: Json
          review_note?: string | null
          reviewed_at?: string | null
          status?: Database["public"]["Enums"]["scoring_status"]
          total_score?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "scorings_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scorings_criteria_id_fkey"
            columns: ["criteria_id"]
            isOneToOne: false
            referencedRelation: "scoring_criteria"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scorings_informa_report_id_fkey"
            columns: ["informa_report_id"]
            isOneToOne: false
            referencedRelation: "informa_reports"
            referencedColumns: ["id"]
          },
        ]
      }
      signature_requests: {
        Row: {
          contract_id: string
          created_at: string
          external_id: string | null
          id: string
          payload: Json | null
          provider: string
          status: string
          updated_at: string
        }
        Insert: {
          contract_id: string
          created_at?: string
          external_id?: string | null
          id?: string
          payload?: Json | null
          provider?: string
          status?: string
          updated_at?: string
        }
        Update: {
          contract_id?: string
          created_at?: string
          external_id?: string | null
          id?: string
          payload?: Json | null
          provider?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "signature_requests_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      contract_workflow_status:
        | "draft"
        | "pending_signature"
        | "signed"
        | "cancelled"
      credit_rating: "AAA" | "AA" | "A" | "BBB" | "BB" | "CCC" | "CC" | "C"
      scoring_decision: "auto" | "limited" | "manual" | "reject"
      scoring_source: "informa_pdf" | "informa_api" | "manual"
      scoring_status: "approved" | "pending_review" | "rejected"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      contract_workflow_status: [
        "draft",
        "pending_signature",
        "signed",
        "cancelled",
      ],
      credit_rating: ["AAA", "AA", "A", "BBB", "BB", "CCC", "CC", "C"],
      scoring_decision: ["auto", "limited", "manual", "reject"],
      scoring_source: ["informa_pdf", "informa_api", "manual"],
      scoring_status: ["approved", "pending_review", "rejected"],
    },
  },
} as const

