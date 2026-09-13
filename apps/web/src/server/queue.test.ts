import { describe, expect, it } from "vitest";
import { enqueue, processInline, registerHandler, runJobOnceForTest, type Job } from "./queue";

describe("queue", () => {
  it("enqueues jobs with bounded attempts", async () => {
    const job = await enqueue("update_analytics", { a: 1 }, { maxAttempts: 5 });
    expect(job.name).toBe("update_analytics");
    expect(job.attempts).toBe(0);
    expect(job.maxAttempts).toBe(5);
  });

  it("processInline throws for unknown handlers", async () => {
    await expect(processInline("send_message", {})).rejects.toThrow();
  });

  it("processInline runs registered handlers", async () => {
    let ran = 0;
    registerHandler("update_analytics", async () => {
      ran++;
    });
    await processInline("update_analytics", {});
    expect(ran).toBe(1);
  });

  it("dead-letters after max attempts without looping forever", async () => {
    registerHandler("send_notification", async () => {
      throw new Error("smtp down");
    });
    const job: Job = { id: "t1", name: "send_notification", payload: {}, attempts: 2, maxAttempts: 3 };
    const outcome = await runJobOnceForTest(job);
    expect(outcome).toBe("dead");
    expect(job.attempts).toBe(3);
  });

  it("schedules retry while attempts remain", async () => {
    const job: Job = { id: "t2", name: "send_notification", payload: {}, attempts: 0, maxAttempts: 2 };
    const outcome = await runJobOnceForTest(job);
    expect(outcome).toBe("retrying");
    expect(job.attempts).toBe(1);
  });
});
