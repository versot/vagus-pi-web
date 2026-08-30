import { DefaultResourceLoader, SettingsManager } from "@earendil-works/pi-coding-agent";

/**
 * Global skill discovery via pi's OWN DefaultResourceLoader.
 *
 * Unlike the old manual frontmatter parser (which only scanned
 * ~/.pi/agent/skills/ and ~/.agents/skills/), this picks up skills from
 * ALL sources pi knows about:
 *   - ~/.pi/agent/skills/           (local)
 *   - ~/.agents/skills/             (shared across agent harnesses)
 *   - pi packages (declared in pi.skills in package.json)
 *   - .pi/skills/                   (project-local)
 *
 * This is the same discovery pi uses for sessions — no duplication, no drift.
 */

export interface SkillEntry {
  name: string;
  description: string;
  path: string;
  /** Source category: "local", "agents", "package", or "project". */
  source: string;
}

/**
 * List all skills discoverable by pi, deduped by name (first found wins).
 * Returns a stable, alphabetically sorted list for the UI settings panel.
 */
export async function listAllSkills(cwd: string, agentDir: string): Promise<SkillEntry[]> {
  try {
    const settingsManager = SettingsManager.create(cwd, agentDir);
    const loader = new DefaultResourceLoader({ cwd, agentDir, settingsManager });
    await loader.reload();
    const result = loader.getSkills();
    const seen = new Set<string>();
    const out: SkillEntry[] = [];
    for (const skill of result.skills) {
      if (seen.has(skill.name)) continue;
      seen.add(skill.name);
      // Derive a source category from pi's SourceInfo for the UI.
      const src = skill.sourceInfo;
      let source = "local";
      if (src.origin === "package") source = "package";
      else if (src.scope === "project") source = "project";
      else if (src.baseDir && src.baseDir.includes(".agents")) source = "agents";
      out.push({ name: skill.name, description: skill.description, path: skill.filePath, source });
    }
    return out.toSorted((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}