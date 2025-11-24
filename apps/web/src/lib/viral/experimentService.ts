import type { SupabaseClient } from "@supabase/supabase-js";

import {
  type CreateExperimentInput,
  type ViralExperimentWithVariants,
  CreateExperimentInput as CreateExperimentInputSchema,
} from "@cliply/shared/schemas/viral";

import { logger } from "../logger";

/**
 * Create an experiment with variants
 */
export async function createExperimentWithVariants(
  input: CreateExperimentInput,
  ctx: { workspaceId: string; supabase: SupabaseClient },
): Promise<ViralExperimentWithVariants> {
  const parsed = CreateExperimentInputSchema.parse(input);

  // Verify workspace access (project must belong to workspace if provided)
  if (parsed.project_id) {
    const { data: project, error: projectError } = await ctx.supabase
      .from("projects")
      .select("workspace_id")
      .eq("id", parsed.project_id)
      .eq("workspace_id", ctx.workspaceId)
      .single();

    if (projectError || !project) {
      logger.warn("experiment_create_project_not_found", {
        workspaceId: ctx.workspaceId,
        projectId: parsed.project_id,
        error: projectError?.message,
      });
      throw new Error("Project not found or does not belong to workspace");
    }
  }

  // Create experiment
  const { data: experiment, error: expError } = await ctx.supabase
    .from("experiments")
    .insert({
      workspace_id: ctx.workspaceId,
      project_id: parsed.project_id ?? null,
      name: parsed.name,
      goal_metric: parsed.goal_metric,
      status: "draft",
    })
    .select()
    .single();

  if (expError || !experiment) {
    logger.error("experiment_create_failed", {
      workspaceId: ctx.workspaceId,
      error: expError?.message,
    });
    throw new Error(`Failed to create experiment: ${expError?.message ?? "unknown"}`);
  }

  // Create variants
  const variantInserts = parsed.variants.map((v) => ({
    experiment_id: experiment.id,
    label: v.label,
    config: v.config,
  }));

  const { data: variants, error: variantsError } = await ctx.supabase
    .from("experiment_variants")
    .insert(variantInserts)
    .select();

  if (variantsError || !variants) {
    // Clean up experiment if variants fail
    await ctx.supabase.from("experiments").delete().eq("id", experiment.id);
    logger.error("experiment_variants_create_failed", {
      workspaceId: ctx.workspaceId,
      experimentId: experiment.id,
      error: variantsError?.message,
    });
    throw new Error(`Failed to create variants: ${variantsError?.message ?? "unknown"}`);
  }

  logger.info("experiment_created", {
    workspaceId: ctx.workspaceId,
    experimentId: experiment.id,
    variantCount: variants.length,
  });

  return {
    ...experiment,
    variants: variants.map((v) => ({
      id: v.id,
      experiment_id: v.experiment_id,
      label: v.label,
      config: v.config as any,
      created_at: v.created_at,
      updated_at: v.updated_at,
    })),
  };
}

/**
 * List all experiments for a workspace
 */
export async function listExperiments(
  ctx: { workspaceId: string; supabase: SupabaseClient },
): Promise<ViralExperimentWithVariants[]> {
  const { data: experiments, error: expError } = await ctx.supabase
    .from("experiments")
    .select("*")
    .eq("workspace_id", ctx.workspaceId)
    .order("created_at", { ascending: false });

  if (expError) {
    logger.error("experiment_list_failed", {
      workspaceId: ctx.workspaceId,
      error: expError.message,
    });
    throw new Error(`Failed to list experiments: ${expError.message}`);
  }

  if (!experiments || experiments.length === 0) {
    return [];
  }

  // Fetch variants for all experiments
  const experimentIds = experiments.map((e) => e.id);
  const { data: variants, error: variantsError } = await ctx.supabase
    .from("experiment_variants")
    .select("*")
    .in("experiment_id", experimentIds)
    .order("created_at", { ascending: true });

  if (variantsError) {
    logger.error("experiment_variants_list_failed", {
      workspaceId: ctx.workspaceId,
      error: variantsError.message,
    });
    throw new Error(`Failed to list variants: ${variantsError.message}`);
  }

  // Group variants by experiment
  const variantsByExperiment = new Map<string, typeof variants>();
  (variants || []).forEach((v) => {
    const existing = variantsByExperiment.get(v.experiment_id) || [];
    existing.push(v);
    variantsByExperiment.set(v.experiment_id, existing);
  });

  return experiments.map((exp) => ({
    ...exp,
    variants: (variantsByExperiment.get(exp.id) || []).map((v) => ({
      id: v.id,
      experiment_id: v.experiment_id,
      label: v.label,
      config: v.config as any,
      created_at: v.created_at,
      updated_at: v.updated_at,
    })),
  }));
}

/**
 * Attach a clip to an experiment variant
 */
export async function attachClipToExperimentVariant(
  params: {
    workspaceId: string;
    clipId: string;
    experimentId: string;
    variantId: string;
  },
  ctx: { supabase: SupabaseClient },
): Promise<void> {
  // Verify experiment belongs to workspace
  const { data: experiment, error: expError } = await ctx.supabase
    .from("experiments")
    .select("id, workspace_id")
    .eq("id", params.experimentId)
    .eq("workspace_id", params.workspaceId)
    .single();

  if (expError || !experiment) {
    logger.warn("attach_clip_experiment_not_found", {
      workspaceId: params.workspaceId,
      experimentId: params.experimentId,
      error: expError?.message,
    });
    throw new Error("Experiment not found or does not belong to workspace");
  }

  // Verify variant belongs to experiment
  const { data: variant, error: variantError } = await ctx.supabase
    .from("experiment_variants")
    .select("id, experiment_id")
    .eq("id", params.variantId)
    .eq("experiment_id", params.experimentId)
    .single();

  if (variantError || !variant) {
    logger.warn("attach_clip_variant_not_found", {
      workspaceId: params.workspaceId,
      variantId: params.variantId,
      experimentId: params.experimentId,
      error: variantError?.message,
    });
    throw new Error("Variant not found or does not belong to experiment");
  }

  // Verify clip belongs to workspace
  const { data: clip, error: clipError } = await ctx.supabase
    .from("clips")
    .select("id, workspace_id")
    .eq("id", params.clipId)
    .eq("workspace_id", params.workspaceId)
    .single();

  if (clipError || !clip) {
    logger.warn("attach_clip_clip_not_found", {
      workspaceId: params.workspaceId,
      clipId: params.clipId,
      error: clipError?.message,
    });
    throw new Error("Clip not found or does not belong to workspace");
  }

  // Update clip with experiment and variant IDs
  const { error: updateError } = await ctx.supabase
    .from("clips")
    .update({
      experiment_id: params.experimentId,
      experiment_variant_id: params.variantId,
    })
    .eq("id", params.clipId);

  if (updateError) {
    logger.error("attach_clip_update_failed", {
      workspaceId: params.workspaceId,
      clipId: params.clipId,
      error: updateError.message,
    });
    throw new Error(`Failed to attach clip to variant: ${updateError.message}`);
  }

  logger.info("clip_attached_to_variant", {
    workspaceId: params.workspaceId,
    clipId: params.clipId,
    experimentId: params.experimentId,
    variantId: params.variantId,
  });
}

/**
 * Find active (running) experiment for a project
 * TODO: Support multiple experiments per project, filtering, etc.
 */
export async function findActiveExperimentForProject(
  params: {
    workspaceId: string;
    projectId: string;
  },
  ctx: { supabase: SupabaseClient },
): Promise<{ id: string; workspace_id: string; project_id: string | null; name: string; status: string; goal_metric: string; created_at: string; updated_at: string } | null> {
  const { data: experiments, error } = await ctx.supabase
    .from("experiments")
    .select("*")
    .eq("workspace_id", params.workspaceId)
    .eq("project_id", params.projectId)
    .eq("status", "running")
    .order("created_at", { ascending: false })
    .limit(1);

  if (error) {
    logger.error("find_active_experiment_failed", {
      workspaceId: params.workspaceId,
      projectId: params.projectId,
      error: error.message,
    });
    throw new Error(`Failed to find active experiment: ${error.message}`);
  }

  return experiments?.[0] ?? null;
}

