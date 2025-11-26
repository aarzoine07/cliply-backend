export type Json = string | number | boolean | null | {
    [key: string]: Json | undefined;
} | Json[];
export type Database = {
    __InternalSupabase: {
        PostgrestVersion: "13.0.4";
    };
    public: {
        Tables: {
            billing_customers: {
                Row: {
                    created_at: string | null;
                    customer_id: string;
                    id: string;
                    user_id: string | null;
                };
                Insert: {
                    created_at?: string | null;
                    customer_id: string;
                    id?: string;
                    user_id?: string | null;
                };
                Update: {
                    created_at?: string | null;
                    customer_id?: string;
                    id?: string;
                    user_id?: string | null;
                };
                Relationships: [
                    {
                        foreignKeyName: "billing_customers_user_id_fkey";
                        columns: ["user_id"];
                        isOneToOne: false;
                        referencedRelation: "users";
                        referencedColumns: ["id"];
                    }
                ];
            };
            clip_products: {
                Row: {
                    clip_id: string;
                    product_id: string;
                };
                Insert: {
                    clip_id: string;
                    product_id: string;
                };
                Update: {
                    clip_id?: string;
                    product_id?: string;
                };
                Relationships: [
                    {
                        foreignKeyName: "clip_products_clip_id_fkey";
                        columns: ["clip_id"];
                        isOneToOne: false;
                        referencedRelation: "clips";
                        referencedColumns: ["id"];
                    },
                    {
                        foreignKeyName: "clip_products_product_id_fkey";
                        columns: ["product_id"];
                        isOneToOne: false;
                        referencedRelation: "products";
                        referencedColumns: ["id"];
                    }
                ];
            };
            clips: {
                Row: {
                    created_at: string;
                    duration_ms: number | null;
                    id: string;
                    project_id: string;
                    render_path: string | null;
                    status: string;
                    title: string;
                    updated_at: string;
                    workspace_id: string;
                };
                Insert: {
                    created_at?: string;
                    duration_ms?: number | null;
                    id?: string;
                    project_id: string;
                    render_path?: string | null;
                    status?: string;
                    title?: string;
                    updated_at?: string;
                    workspace_id: string;
                };
                Update: {
                    created_at?: string;
                    duration_ms?: number | null;
                    id?: string;
                    project_id?: string;
                    render_path?: string | null;
                    status?: string;
                    title?: string;
                    updated_at?: string;
                    workspace_id?: string;
                };
                Relationships: [
                    {
                        foreignKeyName: "clips_project_id_fkey";
                        columns: ["project_id"];
                        isOneToOne: false;
                        referencedRelation: "projects";
                        referencedColumns: ["id"];
                    },
                    {
                        foreignKeyName: "clips_workspace_id_fkey";
                        columns: ["workspace_id"];
                        isOneToOne: false;
                        referencedRelation: "workspaces";
                        referencedColumns: ["id"];
                    }
                ];
            };
            connected_accounts: {
                Row: {
                    access_token_encrypted_ref: string | null;
                    created_at: string;
                    expires_at: string | null;
                    external_id: string;
                    id: string;
                    platform: string;
                    provider: string;
                    refresh_token_encrypted_ref: string | null;
                    scopes: string[] | null;
                    updated_at: string;
                    user_id: string;
                    workspace_id: string;
                };
                Insert: {
                    access_token_encrypted_ref?: string | null;
                    created_at?: string;
                    expires_at?: string | null;
                    external_id: string;
                    id?: string;
                    platform: string;
                    provider: string;
                    refresh_token_encrypted_ref?: string | null;
                    scopes?: string[] | null;
                    updated_at?: string;
                    user_id: string;
                    workspace_id: string;
                };
                Update: {
                    access_token_encrypted_ref?: string | null;
                    created_at?: string;
                    expires_at?: string | null;
                    external_id?: string;
                    id?: string;
                    platform?: string;
                    provider?: string;
                    refresh_token_encrypted_ref?: string | null;
                    scopes?: string[] | null;
                    updated_at?: string;
                    user_id?: string;
                    workspace_id?: string;
                };
                Relationships: [
                    {
                        foreignKeyName: "connected_accounts_workspace_id_fkey";
                        columns: ["workspace_id"];
                        isOneToOne: false;
                        referencedRelation: "workspaces";
                        referencedColumns: ["id"];
                    }
                ];
            };
            dmca_reports: {
                Row: {
                    clip_id: string | null;
                    created_at: string;
                    id: string;
                    reason: string | null;
                    reporter_id: string | null;
                    status: string;
                    updated_at: string;
                    workspace_id: string;
                };
                Insert: {
                    clip_id?: string | null;
                    created_at?: string;
                    id?: string;
                    reason?: string | null;
                    reporter_id?: string | null;
                    status?: string;
                    updated_at?: string;
                    workspace_id: string;
                };
                Update: {
                    clip_id?: string | null;
                    created_at?: string;
                    id?: string;
                    reason?: string | null;
                    reporter_id?: string | null;
                    status?: string;
                    updated_at?: string;
                    workspace_id?: string;
                };
                Relationships: [
                    {
                        foreignKeyName: "dmca_reports_workspace_id_fkey";
                        columns: ["workspace_id"];
                        isOneToOne: false;
                        referencedRelation: "workspaces";
                        referencedColumns: ["id"];
                    }
                ];
            };
            events: {
                Row: {
                    created_at: string;
                    data: Json;
                    id: number;
                    name: string;
                    workspace_id: string;
                };
                Insert: {
                    created_at?: string;
                    data?: Json;
                    id?: number;
                    name: string;
                    workspace_id: string;
                };
                Update: {
                    created_at?: string;
                    data?: Json;
                    id?: number;
                    name?: string;
                    workspace_id?: string;
                };
                Relationships: [
                    {
                        foreignKeyName: "events_workspace_id_fkey";
                        columns: ["workspace_id"];
                        isOneToOne: false;
                        referencedRelation: "workspaces";
                        referencedColumns: ["id"];
                    }
                ];
            };
            events_audit: {
                Row: {
                    actor_id: string | null;
                    created_at: string;
                    event_type: string;
                    id: string;
                    payload: Json;
                    target_id: string | null;
                    workspace_id: string;
                };
                Insert: {
                    actor_id?: string | null;
                    created_at?: string;
                    event_type: string;
                    id?: string;
                    payload?: Json;
                    target_id?: string | null;
                    workspace_id: string;
                };
                Update: {
                    actor_id?: string | null;
                    created_at?: string;
                    event_type?: string;
                    id?: string;
                    payload?: Json;
                    target_id?: string | null;
                    workspace_id?: string;
                };
                Relationships: [
                    {
                        foreignKeyName: "events_audit_workspace_id_fkey";
                        columns: ["workspace_id"];
                        isOneToOne: false;
                        referencedRelation: "workspaces";
                        referencedColumns: ["id"];
                    }
                ];
            };
            idempotency: {
                Row: {
                    created_at: string;
                    expires_at: string | null;
                    key: string;
                    request_hash: string | null;
                    response_hash: string | null;
                    status: string;
                    user_id: string;
                };
                Insert: {
                    created_at?: string;
                    expires_at?: string | null;
                    key: string;
                    request_hash?: string | null;
                    response_hash?: string | null;
                    status: string;
                    user_id: string;
                };
                Update: {
                    created_at?: string;
                    expires_at?: string | null;
                    key?: string;
                    request_hash?: string | null;
                    response_hash?: string | null;
                    status?: string;
                    user_id?: string;
                };
                Relationships: [];
            };
            job_events: {
                Row: {
                    created_at: string;
                    data: Json;
                    id: number;
                    job_id: string;
                    stage: string;
                };
                Insert: {
                    created_at?: string;
                    data?: Json;
                    id?: number;
                    job_id: string;
                    stage: string;
                };
                Update: {
                    created_at?: string;
                    data?: Json;
                    id?: number;
                    job_id?: string;
                    stage?: string;
                };
                Relationships: [
                    {
                        foreignKeyName: "job_events_job_id_fkey";
                        columns: ["job_id"];
                        isOneToOne: false;
                        referencedRelation: "jobs";
                        referencedColumns: ["id"];
                    }
                ];
            };
            jobs: {
                Row: {
                    attempts: number;
                    created_at: string;
                    error: Json | null;
                    id: string;
                    kind: string;
                    last_error: string | null;
                    last_heartbeat: string | null;
                    max_attempts: number;
                    next_run_at: string | null;
                    payload: Json;
                    result: Json | null;
                    run_after: string;
                    state: string;
                    status: string;
                    type: string | null;
                    updated_at: string;
                    worker_id: string | null;
                    workspace_id: string;
                };
                Insert: {
                    attempts?: number;
                    created_at?: string;
                    error?: Json | null;
                    id?: string;
                    kind: string;
                    last_error?: string | null;
                    last_heartbeat?: string | null;
                    max_attempts?: number;
                    next_run_at?: string | null;
                    payload?: Json;
                    result?: Json | null;
                    run_after?: string;
                    state?: string;
                    status?: string;
                    type?: string | null;
                    updated_at?: string;
                    worker_id?: string | null;
                    workspace_id: string;
                };
                Update: {
                    attempts?: number;
                    created_at?: string;
                    error?: Json | null;
                    id?: string;
                    kind?: string;
                    last_error?: string | null;
                    last_heartbeat?: string | null;
                    max_attempts?: number;
                    next_run_at?: string | null;
                    payload?: Json;
                    result?: Json | null;
                    run_after?: string;
                    state?: string;
                    status?: string;
                    type?: string | null;
                    updated_at?: string;
                    worker_id?: string | null;
                    workspace_id?: string;
                };
                Relationships: [
                    {
                        foreignKeyName: "jobs_workspace_id_fkey";
                        columns: ["workspace_id"];
                        isOneToOne: false;
                        referencedRelation: "workspaces";
                        referencedColumns: ["id"];
                    }
                ];
            };
            org_workspaces: {
                Row: {
                    org_id: string;
                    workspace_id: string;
                };
                Insert: {
                    org_id: string;
                    workspace_id: string;
                };
                Update: {
                    org_id?: string;
                    workspace_id?: string;
                };
                Relationships: [
                    {
                        foreignKeyName: "org_workspaces_org_id_fkey";
                        columns: ["org_id"];
                        isOneToOne: false;
                        referencedRelation: "organizations";
                        referencedColumns: ["id"];
                    },
                    {
                        foreignKeyName: "org_workspaces_workspace_id_fkey";
                        columns: ["workspace_id"];
                        isOneToOne: false;
                        referencedRelation: "workspaces";
                        referencedColumns: ["id"];
                    }
                ];
            };
            organizations: {
                Row: {
                    created_at: string;
                    id: string;
                    name: string;
                    owner_id: string;
                };
                Insert: {
                    created_at?: string;
                    id?: string;
                    name: string;
                    owner_id: string;
                };
                Update: {
                    created_at?: string;
                    id?: string;
                    name?: string;
                    owner_id?: string;
                };
                Relationships: [];
            };
            products: {
                Row: {
                    created_at: string;
                    id: string;
                    url: string;
                    workspace_id: string;
                };
                Insert: {
                    created_at?: string;
                    id?: string;
                    url: string;
                    workspace_id: string;
                };
                Update: {
                    created_at?: string;
                    id?: string;
                    url?: string;
                    workspace_id?: string;
                };
                Relationships: [
                    {
                        foreignKeyName: "products_workspace_id_fkey";
                        columns: ["workspace_id"];
                        isOneToOne: false;
                        referencedRelation: "workspaces";
                        referencedColumns: ["id"];
                    }
                ];
            };
            projects: {
                Row: {
                    created_at: string;
                    id: string;
                    source_path: string | null;
                    source_type: string;
                    status: string;
                    title: string;
                    updated_at: string;
                    workspace_id: string;
                };
                Insert: {
                    created_at?: string;
                    id?: string;
                    source_path?: string | null;
                    source_type: string;
                    status?: string;
                    title: string;
                    updated_at?: string;
                    workspace_id: string;
                };
                Update: {
                    created_at?: string;
                    id?: string;
                    source_path?: string | null;
                    source_type?: string;
                    status?: string;
                    title?: string;
                    updated_at?: string;
                    workspace_id?: string;
                };
                Relationships: [
                    {
                        foreignKeyName: "projects_workspace_id_fkey";
                        columns: ["workspace_id"];
                        isOneToOne: false;
                        referencedRelation: "workspaces";
                        referencedColumns: ["id"];
                    }
                ];
            };
            rate_limits: {
                Row: {
                    capacity: number;
                    last_refill: string;
                    refill_per_min: number;
                    route: string;
                    tokens: number;
                    user_id: string;
                    workspace_id: string | null;
                };
                Insert: {
                    capacity?: number;
                    last_refill?: string;
                    refill_per_min?: number;
                    route: string;
                    tokens?: number;
                    user_id: string;
                    workspace_id?: string | null;
                };
                Update: {
                    capacity?: number;
                    last_refill?: string;
                    refill_per_min?: number;
                    route?: string;
                    tokens?: number;
                    user_id?: string;
                    workspace_id?: string | null;
                };
                Relationships: [];
            };
            schedules: {
                Row: {
                    clip_id: string;
                    created_at: string;
                    id: string;
                    run_at: string;
                    status: string;
                    updated_at: string;
                    workspace_id: string;
                };
                Insert: {
                    clip_id: string;
                    created_at?: string;
                    id?: string;
                    run_at: string;
                    status?: string;
                    updated_at?: string;
                    workspace_id: string;
                };
                Update: {
                    clip_id?: string;
                    created_at?: string;
                    id?: string;
                    run_at?: string;
                    status?: string;
                    updated_at?: string;
                    workspace_id?: string;
                };
                Relationships: [
                    {
                        foreignKeyName: "schedules_clip_id_fkey";
                        columns: ["clip_id"];
                        isOneToOne: false;
                        referencedRelation: "clips";
                        referencedColumns: ["id"];
                    },
                    {
                        foreignKeyName: "schedules_workspace_id_fkey";
                        columns: ["workspace_id"];
                        isOneToOne: false;
                        referencedRelation: "workspaces";
                        referencedColumns: ["id"];
                    }
                ];
            };
            subscriptions: {
                Row: {
                    cancel_at_period_end: boolean;
                    created_at: string;
                    current_period_end: string | null;
                    current_period_start: string | null;
                    id: string;
                    plan_name: string;
                    price_id: string;
                    status: string;
                    stripe_customer_id: string;
                    stripe_subscription_id: string;
                    trial_end: string | null;
                    updated_at: string;
                    workspace_id: string;
                };
                Insert: {
                    cancel_at_period_end?: boolean;
                    created_at?: string;
                    current_period_end?: string | null;
                    current_period_start?: string | null;
                    id?: string;
                    plan_name: string;
                    price_id: string;
                    status: string;
                    stripe_customer_id: string;
                    stripe_subscription_id: string;
                    trial_end?: string | null;
                    updated_at?: string;
                    workspace_id: string;
                };
                Update: {
                    cancel_at_period_end?: boolean;
                    created_at?: string;
                    current_period_end?: string | null;
                    current_period_start?: string | null;
                    id?: string;
                    plan_name?: string;
                    price_id?: string;
                    status?: string;
                    stripe_customer_id?: string;
                    stripe_subscription_id?: string;
                    trial_end?: string | null;
                    updated_at?: string;
                    workspace_id?: string;
                };
                Relationships: [
                    {
                        foreignKeyName: "subscriptions_workspace_id_fkey";
                        columns: ["workspace_id"];
                        isOneToOne: false;
                        referencedRelation: "workspaces";
                        referencedColumns: ["id"];
                    }
                ];
            };
            users: {
                Row: {
                    avatar_url: string | null;
                    created_at: string;
                    default_workspace_id: string | null;
                    email: string;
                    full_name: string | null;
                    id: string;
                    updated_at: string;
                };
                Insert: {
                    avatar_url?: string | null;
                    created_at?: string;
                    default_workspace_id?: string | null;
                    email: string;
                    full_name?: string | null;
                    id?: string;
                    updated_at?: string;
                };
                Update: {
                    avatar_url?: string | null;
                    created_at?: string;
                    default_workspace_id?: string | null;
                    email?: string;
                    full_name?: string | null;
                    id?: string;
                    updated_at?: string;
                };
                Relationships: [
                    {
                        foreignKeyName: "users_default_workspace_id_fkey";
                        columns: ["default_workspace_id"];
                        isOneToOne: false;
                        referencedRelation: "workspaces";
                        referencedColumns: ["id"];
                    }
                ];
            };
            workspace_members: {
                Row: {
                    created_at: string;
                    id: string;
                    role: string;
                    user_id: string;
                    workspace_id: string;
                };
                Insert: {
                    created_at?: string;
                    id?: string;
                    role?: string;
                    user_id: string;
                    workspace_id: string;
                };
                Update: {
                    created_at?: string;
                    id?: string;
                    role?: string;
                    user_id?: string;
                    workspace_id?: string;
                };
                Relationships: [
                    {
                        foreignKeyName: "workspace_members_workspace_id_fkey";
                        columns: ["workspace_id"];
                        isOneToOne: false;
                        referencedRelation: "workspaces";
                        referencedColumns: ["id"];
                    }
                ];
            };
            workspaces: {
                Row: {
                    created_at: string;
                    id: string;
                    name: string;
                    org_id: string | null;
                    owner_id: string;
                };
                Insert: {
                    created_at?: string;
                    id?: string;
                    name: string;
                    org_id?: string | null;
                    owner_id: string;
                };
                Update: {
                    created_at?: string;
                    id?: string;
                    name?: string;
                    org_id?: string | null;
                    owner_id?: string;
                };
                Relationships: [
                    {
                        foreignKeyName: "workspaces_org_id_fkey";
                        columns: ["org_id"];
                        isOneToOne: false;
                        referencedRelation: "organizations";
                        referencedColumns: ["id"];
                    }
                ];
            };
        };
        Views: {
            [_ in never]: never;
        };
        Functions: {
            claim_job: {
                Args: {
                    p_worker_id: string;
                };
                Returns: {
                    attempts: number;
                    created_at: string;
                    error: Json | null;
                    id: string;
                    kind: string;
                    last_error: string | null;
                    last_heartbeat: string | null;
                    max_attempts: number;
                    next_run_at: string | null;
                    payload: Json;
                    result: Json | null;
                    run_after: string;
                    state: string;
                    status: string;
                    type: string | null;
                    updated_at: string;
                    worker_id: string | null;
                    workspace_id: string;
                };
                SetofOptions: {
                    from: "*";
                    to: "jobs";
                    isOneToOne: true;
                    isSetofReturn: false;
                };
            };
            fn_consume_token: {
                Args: {
                    p_feature: string;
                    p_workspace_id: string;
                };
                Returns: boolean;
            };
            fn_refill_tokens: {
                Args: {
                    p_feature: string;
                    p_workspace_id: string;
                };
                Returns: undefined;
            };
            jwt_encode: {
                Args: {
                    uid: string;
                };
                Returns: string;
            };
            now_fn: {
                Args: never;
                Returns: string;
            };
            refill_tokens: {
                Args: {
                    p_capacity: number;
                    p_refill_per_min: number;
                    p_route: string;
                    p_user_id: string;
                };
                Returns: number;
            };
            user_has_org_link: {
                Args: {
                    p_workspace_id: string;
                };
                Returns: boolean;
            };
            worker_finish: {
                Args: {
                    p_job_id: string;
                    p_result: Json;
                    p_worker_id: string;
                };
                Returns: {
                    attempts: number;
                    created_at: string;
                    error: Json | null;
                    id: string;
                    kind: string;
                    last_error: string | null;
                    last_heartbeat: string | null;
                    max_attempts: number;
                    next_run_at: string | null;
                    payload: Json;
                    result: Json | null;
                    run_after: string;
                    state: string;
                    status: string;
                    type: string | null;
                    updated_at: string;
                    worker_id: string | null;
                    workspace_id: string;
                };
                SetofOptions: {
                    from: "*";
                    to: "jobs";
                    isOneToOne: true;
                    isSetofReturn: false;
                };
            };
            workspace_id: {
                Args: never;
                Returns: string;
            };
        };
        Enums: {
            [_ in never]: never;
        };
        CompositeTypes: {
            [_ in never]: never;
        };
    };
};
type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;
type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];
export type Tables<DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"]) | {
    schema: keyof DatabaseWithoutInternals;
}, TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
} ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] & DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"]) : never = never> = DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
} ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] & DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
    Row: infer R;
} ? R : never : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"]) ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
    Row: infer R;
} ? R : never : never;
export type TablesInsert<DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"] | {
    schema: keyof DatabaseWithoutInternals;
}, TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
} ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] : never = never> = DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
} ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
    Insert: infer I;
} ? I : never : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"] ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
    Insert: infer I;
} ? I : never : never;
export type TablesUpdate<DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"] | {
    schema: keyof DatabaseWithoutInternals;
}, TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
} ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] : never = never> = DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
} ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
    Update: infer U;
} ? U : never : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"] ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
    Update: infer U;
} ? U : never : never;
export type Enums<DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"] | {
    schema: keyof DatabaseWithoutInternals;
}, EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
} ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"] : never = never> = DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
} ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName] : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"] ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions] : never;
export type CompositeTypes<PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"] | {
    schema: keyof DatabaseWithoutInternals;
}, CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
} ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"] : never = never> = PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
} ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName] : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"] ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions] : never;
export declare const Constants: {
    readonly public: {
        readonly Enums: {};
    };
};
export {};
//# sourceMappingURL=supabase.gen.d.ts.map