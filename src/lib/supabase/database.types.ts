export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      admin_audit_log: {
        Row: {
          action: string
          actor_id: string | null
          at: string
          entity: string | null
          entity_id: string | null
          id: number
          meta: Json
          request_id: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          at?: string
          entity?: string | null
          entity_id?: string | null
          id?: never
          meta?: Json
          request_id?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          at?: string
          entity?: string | null
          entity_id?: string | null
          id?: never
          meta?: Json
          request_id?: string | null
        }
        Relationships: []
      }
      admin_upload_sessions: {
        Row: {
          admin_phone: string
          pending_media: Json
          product_id: string | null
          updated_at: string | null
          variant_id: string | null
        }
        Insert: {
          admin_phone: string
          pending_media?: Json
          product_id?: string | null
          updated_at?: string | null
          variant_id?: string | null
        }
        Update: {
          admin_phone?: string
          pending_media?: Json
          product_id?: string | null
          updated_at?: string | null
          variant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "admin_upload_sessions_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admin_upload_sessions_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_settings: {
        Row: {
          id: boolean
          kill_switch: boolean
          pause_reason: string | null
          paused_until: string | null
          updated_at: string
        }
        Insert: {
          id?: boolean
          kill_switch?: boolean
          pause_reason?: string | null
          paused_until?: string | null
          updated_at?: string
        }
        Update: {
          id?: boolean
          kill_switch?: boolean
          pause_reason?: string | null
          paused_until?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      ai_usage_daily: {
        Row: {
          day: string
          feature: string
          input_tokens: number
          output_tokens: number
          rejected: number
          requests: number
        }
        Insert: {
          day: string
          feature: string
          input_tokens?: number
          output_tokens?: number
          rejected?: number
          requests?: number
        }
        Update: {
          day?: string
          feature?: string
          input_tokens?: number
          output_tokens?: number
          rejected?: number
          requests?: number
        }
        Relationships: []
      }
      carts: {
        Row: {
          items: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          items?: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          items?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      categories: {
        Row: {
          description: string | null
          display_order: number | null
          id: string
          image_url: string | null
          name: string
          slug: string
        }
        Insert: {
          description?: string | null
          display_order?: number | null
          id?: string
          image_url?: string | null
          name: string
          slug: string
        }
        Update: {
          description?: string | null
          display_order?: number | null
          id?: string
          image_url?: string | null
          name?: string
          slug?: string
        }
        Relationships: []
      }
      collection_aliases: {
        Row: {
          alias: string
          collection_id: string
          created_at: string | null
          id: string
        }
        Insert: {
          alias: string
          collection_id: string
          created_at?: string | null
          id?: string
        }
        Update: {
          alias?: string
          collection_id?: string
          created_at?: string | null
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "collection_aliases_collection_id_fkey"
            columns: ["collection_id"]
            isOneToOne: false
            referencedRelation: "collections"
            referencedColumns: ["id"]
          },
        ]
      }
      collection_products: {
        Row: {
          collection_id: string
          display_order: number | null
          product_id: string
        }
        Insert: {
          collection_id: string
          display_order?: number | null
          product_id: string
        }
        Update: {
          collection_id?: string
          display_order?: number | null
          product_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "collection_products_collection_id_fkey"
            columns: ["collection_id"]
            isOneToOne: false
            referencedRelation: "collections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collection_products_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      collections: {
        Row: {
          created_at: string | null
          description: string | null
          display_order: number | null
          id: string
          image_url: string | null
          is_active: boolean | null
          name: string
          slug: string
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          display_order?: number | null
          id?: string
          image_url?: string | null
          is_active?: boolean | null
          name: string
          slug: string
        }
        Update: {
          created_at?: string | null
          description?: string | null
          display_order?: number | null
          id?: string
          image_url?: string | null
          is_active?: boolean | null
          name?: string
          slug?: string
        }
        Relationships: []
      }
      contacts: {
        Row: {
          city: string | null
          created_at: string | null
          id: string
          last_contacted_at: string | null
          name: string
          next_follow_up_on: string | null
          notes: string | null
          phone: string
          rating: number | null
          role: string
          source: string
          status_tag: string
          updated_at: string | null
          whatsapp_opt_in: boolean
        }
        Insert: {
          city?: string | null
          created_at?: string | null
          id?: string
          last_contacted_at?: string | null
          name: string
          next_follow_up_on?: string | null
          notes?: string | null
          phone: string
          rating?: number | null
          role?: string
          source?: string
          status_tag?: string
          updated_at?: string | null
          whatsapp_opt_in?: boolean
        }
        Update: {
          city?: string | null
          created_at?: string | null
          id?: string
          last_contacted_at?: string | null
          name?: string
          next_follow_up_on?: string | null
          notes?: string | null
          phone?: string
          rating?: number | null
          role?: string
          source?: string
          status_tag?: string
          updated_at?: string | null
          whatsapp_opt_in?: boolean
        }
        Relationships: []
      }
      import_assets: {
        Row: {
          batch_id: string
          boundary_start: boolean
          bytes: number | null
          client_upload_id: string
          cloudinary_etag: string | null
          cloudinary_public_id: string | null
          cloudinary_secure_url: string | null
          created_at: string | null
          display_order: number
          duplicate_of_asset_id: string | null
          duration_seconds: number | null
          group_id: string | null
          height: number | null
          id: string
          is_primary: boolean
          kind: string
          original_filename: string | null
          original_relative_path: string | null
          updated_at: string | null
          upload_status: string
          variant_group: string | null
          width: number | null
        }
        Insert: {
          batch_id: string
          boundary_start?: boolean
          bytes?: number | null
          client_upload_id: string
          cloudinary_etag?: string | null
          cloudinary_public_id?: string | null
          cloudinary_secure_url?: string | null
          created_at?: string | null
          display_order?: number
          duplicate_of_asset_id?: string | null
          duration_seconds?: number | null
          group_id?: string | null
          height?: number | null
          id?: string
          is_primary?: boolean
          kind: string
          original_filename?: string | null
          original_relative_path?: string | null
          updated_at?: string | null
          upload_status?: string
          variant_group?: string | null
          width?: number | null
        }
        Update: {
          batch_id?: string
          boundary_start?: boolean
          bytes?: number | null
          client_upload_id?: string
          cloudinary_etag?: string | null
          cloudinary_public_id?: string | null
          cloudinary_secure_url?: string | null
          created_at?: string | null
          display_order?: number
          duplicate_of_asset_id?: string | null
          duration_seconds?: number | null
          group_id?: string | null
          height?: number | null
          id?: string
          is_primary?: boolean
          kind?: string
          original_filename?: string | null
          original_relative_path?: string | null
          updated_at?: string | null
          upload_status?: string
          variant_group?: string | null
          width?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "import_assets_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "import_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "import_assets_duplicate_of_asset_id_fkey"
            columns: ["duplicate_of_asset_id"]
            isOneToOne: false
            referencedRelation: "import_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "import_assets_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "import_product_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      import_batches: {
        Row: {
          created_at: string | null
          created_by_email: string
          id: string
          label: string | null
          manifest: Json | null
          manifest_collection_id: string | null
          source: string
          status: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          created_by_email: string
          id?: string
          label?: string | null
          manifest?: Json | null
          manifest_collection_id?: string | null
          source?: string
          status?: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          created_by_email?: string
          id?: string
          label?: string | null
          manifest?: Json | null
          manifest_collection_id?: string | null
          source?: string
          status?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "import_batches_manifest_collection_id_fkey"
            columns: ["manifest_collection_id"]
            isOneToOne: false
            referencedRelation: "collections"
            referencedColumns: ["id"]
          },
        ]
      }
      import_collection_classifications: {
        Row: {
          candidate_alternatives: Json | null
          collection_id: string | null
          confidence: number | null
          created_at: string | null
          decided_by: string
          evidence: Json | null
          group_id: string
          id: string
          method: string
          state: string
          updated_at: string | null
        }
        Insert: {
          candidate_alternatives?: Json | null
          collection_id?: string | null
          confidence?: number | null
          created_at?: string | null
          decided_by?: string
          evidence?: Json | null
          group_id: string
          id?: string
          method: string
          state: string
          updated_at?: string | null
        }
        Update: {
          candidate_alternatives?: Json | null
          collection_id?: string | null
          confidence?: number | null
          created_at?: string | null
          decided_by?: string
          evidence?: Json | null
          group_id?: string
          id?: string
          method?: string
          state?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "import_collection_classifications_collection_id_fkey"
            columns: ["collection_id"]
            isOneToOne: false
            referencedRelation: "collections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "import_collection_classifications_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: true
            referencedRelation: "import_product_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      import_processing_jobs: {
        Row: {
          attempts: number
          batch_id: string
          created_at: string | null
          group_id: string | null
          id: string
          job_type: string
          last_error: string | null
          status: string
          updated_at: string | null
        }
        Insert: {
          attempts?: number
          batch_id: string
          created_at?: string | null
          group_id?: string | null
          id?: string
          job_type: string
          last_error?: string | null
          status?: string
          updated_at?: string | null
        }
        Update: {
          attempts?: number
          batch_id?: string
          created_at?: string | null
          group_id?: string | null
          id?: string
          job_type?: string
          last_error?: string | null
          status?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "import_processing_jobs_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "import_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "import_processing_jobs_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "import_product_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      import_product_groups: {
        Row: {
          admin_description: string | null
          ai_color_variants: Json | null
          ai_color_variants_generated_at: string | null
          ai_generated_at: string | null
          ai_metadata: Json | null
          ai_warning: string | null
          batch_id: string
          best_variant_group: string | null
          created_at: string | null
          display_order: number
          flagged_reason: string | null
          grouping_method: string
          id: string
          product_id: string | null
          status: string
          updated_at: string | null
        }
        Insert: {
          admin_description?: string | null
          ai_color_variants?: Json | null
          ai_color_variants_generated_at?: string | null
          ai_generated_at?: string | null
          ai_metadata?: Json | null
          ai_warning?: string | null
          batch_id: string
          best_variant_group?: string | null
          created_at?: string | null
          display_order?: number
          flagged_reason?: string | null
          grouping_method?: string
          id?: string
          product_id?: string | null
          status?: string
          updated_at?: string | null
        }
        Update: {
          admin_description?: string | null
          ai_color_variants?: Json | null
          ai_color_variants_generated_at?: string | null
          ai_generated_at?: string | null
          ai_metadata?: Json | null
          ai_warning?: string | null
          batch_id?: string
          best_variant_group?: string | null
          created_at?: string | null
          display_order?: number
          flagged_reason?: string | null
          grouping_method?: string
          id?: string
          product_id?: string | null
          status?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "import_product_groups_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "import_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "import_product_groups_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      inquiries: {
        Row: {
          admin_notes: string | null
          client_request_id: string | null
          created_at: string | null
          email: string | null
          follow_up_on: string | null
          id: string
          inquiry_type: string | null
          message: string | null
          name: string
          phone: string
          product_id: string | null
          product_name: string | null
          source: string | null
          status: string
          status_changed_at: string | null
          utm_campaign: string | null
          utm_medium: string | null
          variant_id: string | null
        }
        Insert: {
          admin_notes?: string | null
          client_request_id?: string | null
          created_at?: string | null
          email?: string | null
          follow_up_on?: string | null
          id?: string
          inquiry_type?: string | null
          message?: string | null
          name: string
          phone: string
          product_id?: string | null
          product_name?: string | null
          source?: string | null
          status?: string
          status_changed_at?: string | null
          utm_campaign?: string | null
          utm_medium?: string | null
          variant_id?: string | null
        }
        Update: {
          admin_notes?: string | null
          client_request_id?: string | null
          created_at?: string | null
          email?: string | null
          follow_up_on?: string | null
          id?: string
          inquiry_type?: string | null
          message?: string | null
          name?: string
          phone?: string
          product_id?: string | null
          product_name?: string | null
          source?: string | null
          status?: string
          status_changed_at?: string | null
          utm_campaign?: string | null
          utm_medium?: string | null
          variant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inquiries_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inquiries_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      inquiry_status_history: {
        Row: {
          actor_id: string | null
          at: string
          from_status: string | null
          id: number
          inquiry_id: string
          to_status: string
        }
        Insert: {
          actor_id?: string | null
          at?: string
          from_status?: string | null
          id?: never
          inquiry_id: string
          to_status: string
        }
        Update: {
          actor_id?: string | null
          at?: string
          from_status?: string | null
          id?: never
          inquiry_id?: string
          to_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "inquiry_status_history_inquiry_id_fkey"
            columns: ["inquiry_id"]
            isOneToOne: false
            referencedRelation: "inquiries"
            referencedColumns: ["id"]
          },
        ]
      }
      product_media_labels: {
        Row: {
          created_at: string
          image_url: string
          label: string
          product_id: string
        }
        Insert: {
          created_at?: string
          image_url: string
          label: string
          product_id: string
        }
        Update: {
          created_at?: string
          image_url?: string
          label?: string
          product_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_media_labels_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      product_source_texts: {
        Row: {
          created_at: string
          product_id: string
          source: string
          source_text: string
        }
        Insert: {
          created_at?: string
          product_id: string
          source?: string
          source_text: string
        }
        Update: {
          created_at?: string
          product_id?: string
          source?: string
          source_text?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_source_texts_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: true
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      product_variants: {
        Row: {
          color: string
          color_hex: string | null
          created_at: string | null
          display_order: number | null
          id: string
          price_max: number | null
          price_min: number | null
          product_id: string | null
          status: string | null
          updated_at: string | null
        }
        Insert: {
          color: string
          color_hex?: string | null
          created_at?: string | null
          display_order?: number | null
          id?: string
          price_max?: number | null
          price_min?: number | null
          product_id?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Update: {
          color?: string
          color_hex?: string | null
          created_at?: string | null
          display_order?: number | null
          id?: string
          price_max?: number | null
          price_min?: number | null
          product_id?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "product_variants_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          base_price_max: number | null
          base_price_min: number | null
          category_id: string | null
          created_at: string | null
          description: string | null
          fabric_type: string | null
          highlights: string[] | null
          id: string
          import_group_id: string | null
          is_featured: boolean | null
          name: string
          needs_review: boolean
          needs_review_reasons: string[]
          product_code: string | null
          review_status: string
          slug: string
          source: string
          status: string
          stock_type: string | null
          updated_at: string | null
          product_stock_signal: {
            availability: string
            availability_note: string | null
            slug: string
            updated_at: string
          } | null
        }
        Insert: {
          base_price_max?: number | null
          base_price_min?: number | null
          category_id?: string | null
          created_at?: string | null
          description?: string | null
          fabric_type?: string | null
          highlights?: string[] | null
          id?: string
          import_group_id?: string | null
          is_featured?: boolean | null
          name: string
          needs_review?: boolean
          needs_review_reasons?: string[]
          product_code?: string | null
          review_status?: string
          slug: string
          source?: string
          status?: string
          stock_type?: string | null
          updated_at?: string | null
        }
        Update: {
          base_price_max?: number | null
          base_price_min?: number | null
          category_id?: string | null
          created_at?: string | null
          description?: string | null
          fabric_type?: string | null
          highlights?: string[] | null
          id?: string
          import_group_id?: string | null
          is_featured?: boolean | null
          name?: string
          needs_review?: boolean
          needs_review_reasons?: string[]
          product_code?: string | null
          review_status?: string
          slug?: string
          source?: string
          status?: string
          stock_type?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "products_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_import_group_id_fkey"
            columns: ["import_group_id"]
            isOneToOne: false
            referencedRelation: "import_product_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          city: string | null
          country: string | null
          email: string | null
          full_name: string | null
          phone: string | null
          shopping_for: string | null
          state: string | null
          updated_at: string
          user_id: string
          whatsapp: string | null
        }
        Insert: {
          city?: string | null
          country?: string | null
          email?: string | null
          full_name?: string | null
          phone?: string | null
          shopping_for?: string | null
          state?: string | null
          updated_at?: string
          user_id: string
          whatsapp?: string | null
        }
        Update: {
          city?: string | null
          country?: string | null
          email?: string | null
          full_name?: string | null
          phone?: string | null
          shopping_for?: string | null
          state?: string | null
          updated_at?: string
          user_id?: string
          whatsapp?: string | null
        }
        Relationships: []
      }
      storefront_availability_history: {
        Row: {
          actor: string
          after_value: Json | null
          before_value: Json | null
          created_at: string
          deleted_at: string | null
          id: number
          slug: string
        }
        Insert: {
          actor: string
          after_value?: Json | null
          before_value?: Json | null
          created_at?: string
          deleted_at?: string | null
          id?: never
          slug: string
        }
        Update: {
          actor?: string
          after_value?: Json | null
          before_value?: Json | null
          created_at?: string
          deleted_at?: string | null
          id?: never
          slug?: string
        }
        Relationships: []
      }
      storefront_availability_overrides: {
        Row: {
          availability: string
          availability_note: string | null
          slug: string
          updated_at: string
        }
        Insert: {
          availability: string
          availability_note?: string | null
          slug: string
          updated_at?: string
        }
        Update: {
          availability?: string
          availability_note?: string | null
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      storefront_page_content: {
        Row: {
          content: Json | null
          draft_content: Json | null
          page: string
          updated_at: string
        }
        Insert: {
          content?: Json | null
          draft_content?: Json | null
          page: string
          updated_at?: string
        }
        Update: {
          content?: Json | null
          draft_content?: Json | null
          page?: string
          updated_at?: string
        }
        Relationships: []
      }
      storefront_page_content_versions: {
        Row: {
          content: Json
          created_at: string
          id: string
          page: string
        }
        Insert: {
          content: Json
          created_at?: string
          id?: string
          page: string
        }
        Update: {
          content?: Json
          created_at?: string
          id?: string
          page?: string
        }
        Relationships: []
      }
      variant_hidden_media: {
        Row: {
          created_at: string
          duplicate_of: string | null
          id: string
          image_url: string
          media_type: string
          original_order: number | null
          product_id: string
          reason: string
          source: string
          variant_id: string | null
        }
        Insert: {
          created_at?: string
          duplicate_of?: string | null
          id?: string
          image_url: string
          media_type?: string
          original_order?: number | null
          product_id: string
          reason: string
          source?: string
          variant_id?: string | null
        }
        Update: {
          created_at?: string
          duplicate_of?: string | null
          id?: string
          image_url?: string
          media_type?: string
          original_order?: number | null
          product_id?: string
          reason?: string
          source?: string
          variant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "variant_hidden_media_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "variant_hidden_media_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      variant_images: {
        Row: {
          display_order: number | null
          id: string
          image_url: string
          is_primary: boolean | null
          media_type: string
          variant_id: string | null
        }
        Insert: {
          display_order?: number | null
          id?: string
          image_url: string
          is_primary?: boolean | null
          media_type?: string
          variant_id?: string | null
        }
        Update: {
          display_order?: number | null
          id?: string
          image_url?: string
          is_primary?: boolean | null
          media_type?: string
          variant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "variant_images_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_batches: {
        Row: {
          analysis: Json | null
          asked_at: string | null
          built_at: string | null
          claim_from: string | null
          claim_to: string | null
          close_reason: string | null
          created_at: string
          description_id: string | null
          detail: string | null
          frozen_at: string | null
          id: string
          legacy_media: Json
          plan: Json | null
          plan_key: string | null
          product_id: string | null
          review: Json | null
          review_state: string | null
          sealed: boolean
          sender_phone: string
          sequence: number
          status: string | null
          summary: string | null
          variant_id: string | null
        }
        Insert: {
          analysis?: Json | null
          asked_at?: string | null
          built_at?: string | null
          claim_from?: string | null
          claim_to?: string | null
          close_reason?: string | null
          created_at?: string
          description_id?: string | null
          detail?: string | null
          frozen_at?: string | null
          id?: string
          legacy_media?: Json
          plan?: Json | null
          plan_key?: string | null
          product_id?: string | null
          review?: Json | null
          review_state?: string | null
          sealed?: boolean
          sender_phone: string
          sequence?: never
          status?: string | null
          summary?: string | null
          variant_id?: string | null
        }
        Update: {
          analysis?: Json | null
          asked_at?: string | null
          built_at?: string | null
          claim_from?: string | null
          claim_to?: string | null
          close_reason?: string | null
          created_at?: string
          description_id?: string | null
          detail?: string | null
          frozen_at?: string | null
          id?: string
          legacy_media?: Json
          plan?: Json | null
          plan_key?: string | null
          product_id?: string | null
          review?: Json | null
          review_state?: string | null
          sealed?: boolean
          sender_phone?: string
          sequence?: never
          status?: string | null
          summary?: string | null
          variant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_batches_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_batches_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_inbox: {
        Row: {
          asset: Json | null
          assignment_reason: string | null
          attempts: number
          batch_id: string
          burst_id: number | null
          completed_at: string | null
          confidence: string | null
          created_at: string
          decided: string | null
          decided_by: string | null
          last_error: string | null
          lease_until: string | null
          message_id: string
          message_ts: string | null
          mode: string
          payload: Json
          reply: string | null
          reply_attempts: number
          reply_lease_until: string | null
          reply_sent: boolean
          resolution: string | null
          sender_phone: string
          sequence: number
          state: string
          token: string | null
        }
        Insert: {
          asset?: Json | null
          assignment_reason?: string | null
          attempts?: number
          batch_id: string
          burst_id?: number | null
          completed_at?: string | null
          confidence?: string | null
          created_at?: string
          decided?: string | null
          decided_by?: string | null
          last_error?: string | null
          lease_until?: string | null
          message_id: string
          message_ts?: string | null
          mode: string
          payload: Json
          reply?: string | null
          reply_attempts?: number
          reply_lease_until?: string | null
          reply_sent?: boolean
          resolution?: string | null
          sender_phone: string
          sequence?: never
          state?: string
          token?: string | null
        }
        Update: {
          asset?: Json | null
          assignment_reason?: string | null
          attempts?: number
          batch_id?: string
          burst_id?: number | null
          completed_at?: string | null
          confidence?: string | null
          created_at?: string
          decided?: string | null
          decided_by?: string | null
          last_error?: string | null
          lease_until?: string | null
          message_id?: string
          message_ts?: string | null
          mode?: string
          payload?: Json
          reply?: string | null
          reply_attempts?: number
          reply_lease_until?: string | null
          reply_sent?: boolean
          resolution?: string | null
          sender_phone?: string
          sequence?: never
          state?: string
          token?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_inbox_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_batches"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_ingest_events: {
        Row: {
          caption: string | null
          created_at: string | null
          id: string
          image_url: string
          media_id: string
          message_id: string
          message_timestamp: string
          product_id: string | null
          raw_payload: Json | null
          sender_name: string | null
          sender_phone: string
          updated_at: string | null
          variant_id: string | null
        }
        Insert: {
          caption?: string | null
          created_at?: string | null
          id?: string
          image_url: string
          media_id: string
          message_id: string
          message_timestamp: string
          product_id?: string | null
          raw_payload?: Json | null
          sender_name?: string | null
          sender_phone: string
          updated_at?: string | null
          variant_id?: string | null
        }
        Update: {
          caption?: string | null
          created_at?: string | null
          id?: string
          image_url?: string
          media_id?: string
          message_id?: string
          message_timestamp?: string
          product_id?: string | null
          raw_payload?: Json | null
          sender_name?: string | null
          sender_phone?: string
          updated_at?: string | null
          variant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_ingest_events_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_ingest_events_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_notices: {
        Row: {
          attempts: number
          body: string
          created_at: string
          dedupe_key: string
          id: string
          kind: string
          lease_until: string | null
          not_before: string
          sender_phone: string
          sent: boolean
          sequence: number
        }
        Insert: {
          attempts?: number
          body: string
          created_at?: string
          dedupe_key: string
          id?: string
          kind: string
          lease_until?: string | null
          not_before?: string
          sender_phone: string
          sent?: boolean
          sequence?: never
        }
        Update: {
          attempts?: number
          body?: string
          created_at?: string
          dedupe_key?: string
          id?: string
          kind?: string
          lease_until?: string | null
          not_before?: string
          sender_phone?: string
          sent?: boolean
          sequence?: never
        }
        Relationships: []
      }
      whatsapp_settings: {
        Row: {
          key: string
          note: string | null
          value: string
        }
        Insert: {
          key: string
          note?: string | null
          value: string
        }
        Update: {
          key?: string
          note?: string | null
          value?: string
        }
        Relationships: []
      }
      whatsapp_subscribers: {
        Row: {
          id: string
          name: string
          opted_in_at: string | null
          phone: string
          source: string | null
        }
        Insert: {
          id?: string
          name: string
          opted_in_at?: string | null
          phone: string
          source?: string | null
        }
        Update: {
          id?: string
          name?: string
          opted_in_at?: string | null
          phone?: string
          source?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      storefront_hidden_slugs: {
        Row: {
          slug: string | null
        }
        Relationships: []
      }
      whatsapp_listing_audit: {
        Row: {
          assignment_reason: string | null
          burst_id: number | null
          close_reason: string | null
          confidence: string | null
          decided_by: string | null
          description: string | null
          description_id: string | null
          frozen_at: string | null
          kind: string | null
          listing: number | null
          message_id: string | null
          message_ts: string | null
          mode: string | null
          product_id: string | null
          product_name: string | null
          received_at: string | null
          review_state: string | null
          seconds_before_description: number | null
          sender_phone: string | null
          slug: string | null
          state: string | null
          status: string | null
          summary: string | null
          url: string | null
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_batches_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      admin_audit_prune: { Args: { p_keep?: string }; Returns: number }
      ai_pause: {
        Args: { p_reason: string; p_until: string }
        Returns: undefined
      }
      ai_record_usage: {
        Args: { p_feature: string; p_input: number; p_output: number }
        Returns: undefined
      }
      ai_set_kill_switch: {
        Args: { p_clear_pause?: boolean; p_on: boolean }
        Returns: undefined
      }
      ai_try_reserve: {
        Args: { p_cap: number; p_feature: string }
        Returns: string
      }
      append_whatsapp_pending_media: {
        Args: { p_admin_phone: string; p_item: Json }
        Returns: undefined
      }
      change_storefront_availability: {
        Args: { actor_email: string; changes: Json }
        Returns: Json
      }
      checkpoint_whatsapp_asset: {
        Args: { p_asset: Json; p_message_id: string; p_token: string }
        Returns: undefined
      }
      checkpoint_whatsapp_plan: {
        Args: {
          p_analysis: Json
          p_key: string
          p_message_id: string
          p_plan: Json
          p_token: string
        }
        Returns: undefined
      }
      claim_next_whatsapp_message: {
        Args: { p_sender_phone: string }
        Returns: Json
      }
      claim_whatsapp_message: { Args: { p_message_id: string }; Returns: Json }
      claim_whatsapp_replies: {
        Args: { p_sender_phone: string }
        Returns: Json
      }
      complete_whatsapp_message: {
        Args: { p_message_id: string; p_plan: Json; p_token: string }
        Returns: Json
      }
      enqueue_whatsapp_messages: {
        Args: { p_messages: Json }
        Returns: undefined
      }
      fail_whatsapp_message: {
        Args: { p_error: string; p_message_id: string; p_token: string }
        Returns: undefined
      }
      finish_whatsapp_reply: {
        Args: { p_message_id: string; p_sent: boolean }
        Returns: undefined
      }
      inquiry_set_status: {
        Args: { p_actor: string; p_id: string; p_status: string }
        Returns: string
      }
      inquiry_source_report: {
        Args: { p_weeks?: number }
        Returns: {
          enquiries: number
          source: string
          status: string
          week: string
        }[]
      }
      product_stock_signal: {
        Args: { "": Database["public"]["Tables"]["products"]["Row"] }
        Returns: {
          availability: string
          availability_note: string | null
          slug: string
          updated_at: string
        }
        SetofOptions: {
          from: "products"
          to: "storefront_availability_overrides"
          isOneToOne: true
          isSetofReturn: true
        }
      }
      resolve_whatsapp_review: {
        Args: { p_message_id: string; p_outcome: Json; p_token: string }
        Returns: undefined
      }
      restore_hidden_media: { Args: { p_id: string }; Returns: string }
      save_storefront_page_draft: {
        Args: { p_draft: Json; p_page: string }
        Returns: undefined
      }
      whatsapp_after_product: {
        Args: { p_batch: string; p_plan: Json; p_product: string }
        Returns: undefined
      }
      whatsapp_assign: {
        Args: {
          p_batch: string
          p_bursts: number[]
          p_confidence: string
          p_reason: string
          p_sender: string
        }
        Returns: undefined
      }
      whatsapp_burst_rows: {
        Args: { p_bursts: number[]; p_sender: string }
        Returns: {
          asset: Json | null
          assignment_reason: string | null
          attempts: number
          batch_id: string
          burst_id: number | null
          completed_at: string | null
          confidence: string | null
          created_at: string
          decided: string | null
          decided_by: string | null
          last_error: string | null
          lease_until: string | null
          message_id: string
          message_ts: string | null
          mode: string
          payload: Json
          reply: string | null
          reply_attempts: number
          reply_lease_until: string | null
          reply_sent: boolean
          resolution: string | null
          sender_phone: string
          sequence: number
          state: string
          token: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "whatsapp_inbox"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      whatsapp_bury: {
        Args: { p_error: string; p_message_id: string }
        Returns: undefined
      }
      whatsapp_claimable: { Args: { p_message_id: string }; Returns: boolean }
      whatsapp_close_empty: {
        Args: { p_message_id: string; p_reason: string; p_reply: string }
        Returns: undefined
      }
      whatsapp_finish_unassigned: {
        Args: { p_sender: string }
        Returns: undefined
      }
      whatsapp_freeze: {
        Args: { p_batch: string; p_reason: string }
        Returns: undefined
      }
      whatsapp_label: { Args: { p_text: string }; Returns: string }
      whatsapp_message_blocked: {
        Args: { job: Database["public"]["Tables"]["whatsapp_inbox"]["Row"] }
        Returns: boolean
      }
      whatsapp_next_wake: { Args: { p_sender_phone: string }; Returns: number }
      whatsapp_notify: {
        Args: {
          p_body: string
          p_delay?: string
          p_key: string
          p_kind: string
          p_sender: string
        }
        Returns: undefined
      }
      whatsapp_place_stragglers: {
        Args: { p_sender: string }
        Returns: undefined
      }
      whatsapp_pool: { Args: { p_sender: string }; Returns: string }
      whatsapp_price_reply: {
        Args: {
          p_cap: string
          p_message: Json
          p_phone: string
          p_sent_at: string
        }
        Returns: boolean
      }
      whatsapp_regroup: { Args: { p_sender: string }; Returns: undefined }
      whatsapp_regroup_safely: {
        Args: { p_sender: string }
        Returns: undefined
      }
      whatsapp_set_aside: {
        Args: {
          p_bursts: number[]
          p_detail: string
          p_sender: string
          p_summary: string
        }
        Returns: undefined
      }
      whatsapp_set_aside_rows: {
        Args: {
          p_detail: string
          p_ids: string[]
          p_sender: string
          p_summary: string
        }
        Returns: undefined
      }
      whatsapp_setting: {
        Args: { p_default: number; p_key: string }
        Returns: string
      }
      whatsapp_settled: { Args: { p_message_ids: string[] }; Returns: boolean }
      whatsapp_sweep: { Args: { p_sender_phone?: string }; Returns: Json }
      whatsapp_take: { Args: { p_message_id: string }; Returns: Json }
    }
    Enums: {
      [_ in never]: never
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
  public: {
    Enums: {},
  },
} as const

