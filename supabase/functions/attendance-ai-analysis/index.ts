import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { handleCors, jsonResponse } from "../_shared/cors.ts"
import { createSupabaseAdmin, verifyAuth, isAdmin } from "../_shared/supabase.ts"

interface AIAnalysisRequest {
  month?: number
  year?: number
  teacher_id?: string
  provider?: "openai" | "deepseek"
}

Deno.serve(async (req: Request) => {
  const cors = handleCors(req)
  if (cors) return cors

  try {
    const auth = await verifyAuth(req.headers.get("Authorization"))
    if (auth.error) {
      return jsonResponse({ error: auth.error }, 401)
    }

    const supabase = createSupabaseAdmin()

    if (!(await isAdmin(supabase))) {
      return jsonResponse({ error: "Forbidden: Admin access required" }, 403)
    }

    if (req.method !== "POST") {
      return jsonResponse({ error: "Method not allowed" }, 405)
    }

    const body: AIAnalysisRequest = await req.json()
    const now = new Date()
    const year = body.year ?? now.getFullYear()
    const month = body.month ?? now.getMonth() + 1

    const startDate = `${year}-${String(month).padStart(2, "0")}-01`
    const endDate = new Date(year, month, 0).toISOString().slice(0, 10)

    let attQuery = supabase
      .from("attendance")
      .select("teacher_id, status, late_minutes, working_minutes, attendance_date")
      .gte("attendance_date", startDate)
      .lte("attendance_date", endDate)

    if (body.teacher_id) {
      attQuery = attQuery.eq("teacher_id", body.teacher_id)
    }

    const { data: attendance, error: attErr } = await attQuery
    if (attErr) throw attErr

    const { data: teachers, error: tErr } = await supabase
      .from("teachers")
      .select("id, full_name, staff_number")
      .eq("employment_status", "active")

    if (tErr) throw tErr

    const teacherAgg = new Map<
      string,
      {
        total: number
        late: number
        absent: number
        present: number
        lateMinutes: number[]
        workingMinutes: number[]
        name: string
      }
    >()

    for (const t of teachers ?? []) {
      teacherAgg.set(t.id, {
        total: 0,
        late: 0,
        absent: 0,
        present: 0,
        lateMinutes: [],
        workingMinutes: [],
        name: t.full_name,
      })
    }

    for (const a of attendance ?? []) {
      const agg = teacherAgg.get(a.teacher_id)
      if (!agg) continue
      agg.total++
      if (a.status === "late") {
        agg.late++
        if (a.late_minutes) agg.lateMinutes.push(a.late_minutes)
      } else if (a.status === "absent") {
        agg.absent++
      } else if (["present", "checked_out"].includes(a.status ?? "")) {
        agg.present++
      }
      if (a.working_minutes) agg.workingMinutes.push(a.working_minutes)
    }

    const frequentLate = Array.from(teacherAgg.entries())
      .filter(([, a]) => a.late >= 3)
      .map(([id, a]) => ({
        teacher_id: id,
        name: a.name,
        late_count: a.late,
        avg_late_minutes:
          a.lateMinutes.length > 0
            ? Math.round(a.lateMinutes.reduce((s, m) => s + m, 0) / a.lateMinutes.length)
            : 0,
      }))
      .sort((a, b) => b.late_count - a.late_count)

    const topAbsent = Array.from(teacherAgg.entries())
      .filter(([, a]) => a.absent >= 2)
      .map(([id, a]) => ({
        teacher_id: id,
        name: a.name,
        absent_count: a.absent,
      }))
      .sort((a, b) => b.absent_count - a.absent_count)

    const overallLate = attendance?.filter((a) => a.status === "late").length ?? 0
    const overallAbsent = attendance?.filter((a) => a.status === "absent").length ?? 0
    const overallPresent = attendance?.filter((a) =>
      ["present", "checked_out"].includes(a.status ?? "")
    ).length ?? 0
    const totalRecords = attendance?.length ?? 0

    const workingMins =
      attendance
        ?.map((a) => a.working_minutes)
        .filter((m): m is number => m !== null) ?? []
    const avgWorkingHours =
      workingMins.length > 0
        ? Math.round(
            (workingMins.reduce((a, b) => a + b, 0) / workingMins.length) * 10
          ) / 10
        : 0

    const insights = {
      month: `${year}-${String(month).padStart(2, "0")}`,
      summary: {
        total_records: totalRecords,
        present: overallPresent,
        late: overallLate,
        absent: overallAbsent,
        avg_working_minutes: avgWorkingHours,
        attendance_rate:
          totalRecords > 0
            ? Math.round(((overallPresent + overallLate) / totalRecords) * 100)
            : 0,
      },
      teachers_with_frequent_lateness: frequentLate,
      teachers_with_high_absenteeism: topAbsent,
      suggestions: [] as string[],
    }

    if (frequentLate.length > 0) {
      insights.suggestions.push(
        `${frequentLate.length} teacher(s) have been late 3+ times this month. Consider implementing a reminder system or reviewing start time policies.`
      )
    }
    if (topAbsent.length > 0) {
      insights.suggestions.push(
        `${topAbsent.length} teacher(s) have 2+ absences. Follow up to identify underlying causes.`
      )
    }
    if (insights.summary.attendance_rate < 80) {
      insights.suggestions.push(
        `Overall attendance rate is ${insights.summary.attendance_rate}%. Consider organizing a staff meeting to address attendance concerns.`
      )
    } else if (insights.summary.attendance_rate >= 95) {
      insights.suggestions.push(
        `Excellent attendance rate at ${insights.summary.attendance_rate}%. Keep up the great work!`
      )
    }

    const openaiApiKey = Deno.env.get("OPENAI_API_KEY")
    const deepseekApiKey = Deno.env.get("DEEPSEEK_API_KEY")
    const provider = body.provider ?? (openaiApiKey ? "openai" : null)

    let aiGenerated = null

    if (provider === "openai" && openaiApiKey) {
      try {
        const prompt = `Analyze this school attendance data for ${year}-${String(month).padStart(2, "0")}:
- Total records: ${totalRecords}
- Present: ${overallPresent}, Late: ${overallLate}, Absent: ${overallAbsent}
- Attendance rate: ${insights.summary.attendance_rate}%
- Teachers frequently late: ${JSON.stringify(frequentLate)}
- Teachers with high absenteeism: ${JSON.stringify(topAbsent)}

Provide 3-5 actionable recommendations in JSON format: { recommendations: string[] }`

        const response = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${openaiApiKey}`,
          },
          body: JSON.stringify({
            model: "gpt-4o-mini",
            messages: [
              {
                role: "system",
                content:
                  "You are an attendance analytics expert for schools. Provide concise, actionable insights.",
              },
              { role: "user", content: prompt },
            ],
            max_tokens: 500,
          }),
        })

        if (response.ok) {
          const result = await response.json()
          try {
            const parsed = JSON.parse(result.choices[0].message.content)
            aiGenerated = { provider: "openai", recommendations: parsed.recommendations }
          } catch {
            aiGenerated = {
              provider: "openai",
              raw: result.choices[0].message.content,
            }
          }
        } else {
          console.error("OpenAI API error:", await response.text())
        }
      } catch (aiErr) {
        console.error("OpenAI call failed:", aiErr)
      }
    } else if (provider === "deepseek" && deepseekApiKey) {
      try {
        const response = await fetch("https://api.deepseek.com/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${deepseekApiKey}`,
          },
          body: JSON.stringify({
            model: "deepseek-chat",
            messages: [
              {
                role: "system",
                content: "You are an attendance analytics expert for schools.",
              },
              {
                role: "user",
                content: `Analyze attendance data for ${year}-${String(month).padStart(2, "0")}: ${JSON.stringify(insights)}`,
              },
            ],
            max_tokens: 500,
          }),
        })

        if (response.ok) {
          const result = await response.json()
          aiGenerated = { provider: "deepseek", raw: result.choices[0].message.content }
        }
      } catch (aiErr) {
        console.error("DeepSeek API call failed:", aiErr)
      }
    }

    return jsonResponse({
      success: true,
      insights,
      ai_generated: aiGenerated,
      config: {
        provider_configured: provider ?? null,
        openai_available: !!openaiApiKey,
        deepseek_available: !!deepseekApiKey,
      },
    })
  } catch (err) {
    console.error("attendance-ai-analysis error:", err)
    return jsonResponse(
      { error: err instanceof Error ? err.message : "Internal server error" },
      500
    )
  }
})
