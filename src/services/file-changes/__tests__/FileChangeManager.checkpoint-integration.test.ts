// Integration test for FileChangeManager + Checkpoint Service
// npx vitest run services/file-changes/__tests__/FileChangeManager.checkpoint-integration.test.ts

import { describe, beforeEach, afterEach, it, expect, vi } from "vitest"

// Override vscode mock for these specific tests with working EventEmitter
vi.mock("vscode", async () => {
	const originalVscode = await vi.importActual("../../../__mocks__/vscode.js")

	// Create working EventEmitter constructor function
	const WorkingEventEmitter = function (this: any) {
		this.listeners = []

		this.event = (listener: any) => {
			this.listeners.push(listener)
			return {
				dispose: () => {
					const index = this.listeners.indexOf(listener)
					if (index >= 0) {
						this.listeners.splice(index, 1)
					}
				},
			}
		}

		this.fire = (data: any) => {
			this.listeners.forEach((listener: any) => {
				try {
					listener(data)
				} catch (e) {
					// Ignore listener errors in tests
				}
			})
		}

		this.dispose = () => {
			this.listeners = []
		}
	}

	return {
		...originalVscode,
		EventEmitter: WorkingEventEmitter,
	}
})
import fs from "fs/promises"
import path from "path"
import os from "os"
import { simpleGit, SimpleGit } from "simple-git"

import { FileChangeManager } from "../FileChangeManager"
import { RepoPerTaskCheckpointService } from "../../checkpoints/RepoPerTaskCheckpointService"

const tmpDir = path.join(os.tmpdir(), "FileChangeManager-CheckpointIntegration")

const initWorkspaceRepo = async ({
	workspaceDir,
	userName = "Roo Code",
	userEmail = "support@roocode.com",
	testFileName = "test.txt",
	textFileContent = "Hello, world!",
}: {
	workspaceDir: string
	userName?: string
	userEmail?: string
	testFileName?: string
	textFileContent?: string
}) => {
	// Create a temporary directory for testing.
	await fs.mkdir(workspaceDir, { recursive: true })

	// Initialize git repo.
	const git = simpleGit(workspaceDir)
	await git.init()
	await git.addConfig("user.name", userName)
	await git.addConfig("user.email", userEmail)

	// Create test file.
	const testFile = path.join(workspaceDir, testFileName)
	await fs.writeFile(testFile, textFileContent)

	// Create initial commit.
	await git.add(".")
	await git.commit("Initial commit")!

	return { git, testFile }
}

describe("FileChangeManager + Checkpoint Service Integration", () => {
	let workspaceGit: SimpleGit
	let testFile: string
	let checkpointService: RepoPerTaskCheckpointService
	let fileChangeManager: FileChangeManager
	let workspaceDir: string
	let shadowDir: string

	beforeEach(async () => {
		// Create unique directories for this test
		const testId = Date.now()
		shadowDir = path.join(tmpDir, `shadow-${testId}`)
		workspaceDir = path.join(tmpDir, `workspace-${testId}`)

		// Initialize workspace repo
		const repo = await initWorkspaceRepo({ workspaceDir })
		workspaceGit = repo.git
		testFile = repo.testFile

		// Create checkpoint service
		checkpointService = await RepoPerTaskCheckpointService.create({
			taskId: "test-task",
			shadowDir,
			workspaceDir,
			log: () => {},
		})
		await checkpointService.initShadowGit()

		// Create FileChangeManager with the checkpoint service's base hash
		// Use a unique task ID per test to avoid conflicts
		const uniqueTaskId = `test-task-${Date.now()}`
		fileChangeManager = new FileChangeManager(checkpointService.baseHash!, uniqueTaskId, shadowDir)
	})

	afterEach(async () => {
		// Dispose resources first
		fileChangeManager?.dispose()

		// Wait a bit for any pending operations to complete
		await new Promise((resolve) => setTimeout(resolve, 100))

		// Clean up directories individually
		try {
			if (shadowDir) {
				await fs.rm(shadowDir, { recursive: true, force: true })
			}
		} catch {
			// Ignore cleanup errors
		}

		try {
			if (workspaceDir) {
				await fs.rm(workspaceDir, { recursive: true, force: true })
			}
		} catch {
			// Ignore cleanup errors
		}
	})

	afterAll(async () => {
		// Final cleanup of the entire temp directory
		try {
			await fs.rm(tmpDir, { recursive: true, force: true })
		} catch {
			// Ignore cleanup errors
		}
	})

	describe("Normal Flow: File Edits → Checkpoint Save → FilesChangedOverview Updates", () => {
		it("should track file changes when checkpoint is created", async () => {
			// Phase 1: Make file edits (simulate AI making changes)
			await fs.writeFile(testFile, "First change by AI")

			// Create a new file
			const newFile = path.join(workspaceDir, "new-file.txt")
			await fs.writeFile(newFile, "New file content")

			// Phase 2: Create checkpoint (this should capture the changes)
			const checkpoint1 = await checkpointService.saveCheckpoint("First checkpoint")
			expect(checkpoint1?.commit).toBeTruthy()

			// Phase 3: Record changes in FileChangeManager (simulating what DiffViewProvider does)
			fileChangeManager.recordChange(
				"test.txt",
				"edit",
				checkpointService.baseHash!,
				checkpoint1!.commit,
				1, // lines added
				1, // lines removed
			)

			fileChangeManager.recordChange(
				"new-file.txt",
				"create",
				checkpointService.baseHash!,
				checkpoint1!.commit,
				1, // lines added
				0, // lines removed
			)

			// Phase 4: Verify FilesChangedOverview shows the changes
			const changes = fileChangeManager.getChanges()
			expect(changes.files).toHaveLength(2)
			expect(changes.baseCheckpoint).toBe(checkpointService.baseHash)

			const testFileChange = changes.files.find((f) => f.uri === "test.txt")
			expect(testFileChange).toBeDefined()
			expect(testFileChange!.type).toBe("edit")
			expect(testFileChange!.toCheckpoint).toBe(checkpoint1!.commit)

			const newFileChange = changes.files.find((f) => f.uri === "new-file.txt")
			expect(newFileChange).toBeDefined()
			expect(newFileChange!.type).toBe("create")
			expect(newFileChange!.toCheckpoint).toBe(checkpoint1!.commit)
		})
	})

	describe("Restoration Flow: Checkpoint Restore → FilesChangedOverview Updates", () => {
		it("should properly update FilesChangedOverview when restoring to earlier checkpoint", async () => {
			// Simplified test to understand the behavior

			// Create one file change
			await fs.writeFile(testFile, "Changed content")
			const checkpoint1 = await checkpointService.saveCheckpoint("First checkpoint")
			expect(checkpoint1?.commit).toBeTruthy()

			// Record the change in FileChangeManager
			fileChangeManager.recordChange("test.txt", "edit", checkpointService.baseHash!, checkpoint1!.commit, 1, 1)

			// Verify change is tracked
			let changes = fileChangeManager.getChanges()
			expect(changes.files).toHaveLength(1)

			// Test what happens when we restore to the same checkpoint that the file was changed to
			await checkpointService.restoreCheckpoint(checkpoint1!.commit)

			// Call updateBaseline to simulate checkpoint restoration
			await fileChangeManager.updateBaseline(
				checkpoint1!.commit, // New baseline is checkpoint1
				(from, to) => {
					console.log(`getDiff called with from=${from}, to=${to}`)
					if (from === to) {
						console.log("Same checkpoint - returning empty diff")
						return Promise.resolve([])
					}
					return checkpointService.getDiff({ from, to })
				},
				{
					baseHash: checkpointService.baseHash,
					_checkpoints: checkpointService.checkpoints,
				},
			)

			// Since we restored to checkpoint1, and the file was changed TO checkpoint1,
			// there should be no diff between checkpoint1 and checkpoint1, so file should be removed
			changes = fileChangeManager.getChanges()
			expect(changes.baseCheckpoint).toBe(checkpoint1!.commit)
			expect(changes.files).toHaveLength(0)
		})

		it("should remove files when restoring to checkpoint after their creation", async () => {
			// Create checkpoint1 with initial state
			await fs.writeFile(testFile, "First change")
			const checkpoint1 = await checkpointService.saveCheckpoint("First checkpoint")
			expect(checkpoint1?.commit).toBeTruthy()

			// Create checkpoint2 with new file
			const newFile = path.join(workspaceDir, "new-file.txt")
			await fs.writeFile(newFile, "New file content")
			const checkpoint2 = await checkpointService.saveCheckpoint("Second checkpoint")
			expect(checkpoint2?.commit).toBeTruthy()

			// Record the file changes
			fileChangeManager.recordChange("test.txt", "edit", checkpointService.baseHash!, checkpoint1!.commit, 1, 1)
			fileChangeManager.recordChange(
				"new-file.txt",
				"create",
				checkpointService.baseHash!,
				checkpoint2!.commit,
				1,
				0,
			)

			// Verify we have both changes
			let changes = fileChangeManager.getChanges()
			expect(changes.files).toHaveLength(2)

			// Restore to checkpoint2 (after new-file.txt was created)
			await checkpointService.restoreCheckpoint(checkpoint2!.commit)

			// Simulate the updateBaseline call
			await fileChangeManager.updateBaseline(
				checkpoint2!.commit,
				(from, to) => checkpointService.getDiff({ from, to }),
				{
					baseHash: checkpointService.baseHash,
					_checkpoints: checkpointService.checkpoints,
				},
			)

			// Verify files are properly handled
			changes = fileChangeManager.getChanges()
			expect(changes.baseCheckpoint).toBe(checkpoint2!.commit)

			// Since we restored to checkpoint2, both files should be removed from tracking
			// because the new baseline (checkpoint2) includes all their changes
			expect(changes.files).toHaveLength(0)
		})

		it("should handle restoration to base checkpoint correctly", async () => {
			// Create some changes and checkpoints
			await fs.writeFile(testFile, "Modified content")
			const checkpoint1 = await checkpointService.saveCheckpoint("First checkpoint")
			expect(checkpoint1?.commit).toBeTruthy()

			// Record the change (from base to checkpoint1)
			fileChangeManager.recordChange("test.txt", "edit", checkpointService.baseHash!, checkpoint1!.commit, 1, 1)

			// Verify change is tracked
			let changes = fileChangeManager.getChanges()
			expect(changes.files).toHaveLength(1)

			// Restore to base checkpoint (earlier than the file's toCheckpoint)
			await checkpointService.restoreCheckpoint(checkpointService.baseHash!)

			// Simulate the updateBaseline call
			await fileChangeManager.updateBaseline(
				checkpointService.baseHash!,
				(from, to) => {
					// When restoring to base, and file was changed TO checkpoint1,
					// we need to check if baseHash < checkpoint1
					if (from === checkpointService.baseHash && to === checkpoint1!.commit) {
						// There should be a diff from base to checkpoint1
						return checkpointService.getDiff({ from, to })
					}
					return checkpointService.getDiff({ from, to })
				},
				{
					baseHash: checkpointService.baseHash,
					_checkpoints: checkpointService.checkpoints,
				},
			)

			// Since we restored to baseHash, and the file was changed from baseHash to checkpoint1,
			// the file should be kept and recalculated (from baseHash to checkpoint1)
			changes = fileChangeManager.getChanges()
			expect(changes.baseCheckpoint).toBe(checkpointService.baseHash)
			expect(changes.files).toHaveLength(1)

			const fileChange = changes.files[0]
			expect(fileChange.uri).toBe("test.txt")
			expect(fileChange.fromCheckpoint).toBe(checkpointService.baseHash)
			expect(fileChange.toCheckpoint).toBe(checkpoint1!.commit)
		})
	})

	describe("Chronological Comparison with Real Checkpoint Hashes", () => {
		it("should correctly use isCheckpointBefore with real git commit hashes", async () => {
			// Create multiple checkpoints to test chronological comparison
			await fs.writeFile(testFile, "Change 1")
			const checkpoint1 = await checkpointService.saveCheckpoint("Checkpoint 1")

			await fs.writeFile(testFile, "Change 2")
			const checkpoint2 = await checkpointService.saveCheckpoint("Checkpoint 2")

			await fs.writeFile(testFile, "Change 3")
			const checkpoint3 = await checkpointService.saveCheckpoint("Checkpoint 3")

			expect(checkpoint1?.commit).toBeTruthy()
			expect(checkpoint2?.commit).toBeTruthy()
			expect(checkpoint3?.commit).toBeTruthy()

			// Record a change that goes to checkpoint3
			fileChangeManager.recordChange("test.txt", "edit", checkpointService.baseHash!, checkpoint3!.commit, 3, 1)

			// Test restoring to checkpoint1 (before the file's toCheckpoint)
			await checkpointService.restoreCheckpoint(checkpoint1!.commit)
			await fileChangeManager.updateBaseline(
				checkpoint1!.commit,
				(from, to) => checkpointService.getDiff({ from, to }),
				{
					baseHash: checkpointService.baseHash,
					_checkpoints: checkpointService.checkpoints,
				},
			)

			// File should be kept and recalculated since checkpoint1 < checkpoint3
			let changes = fileChangeManager.getChanges()
			expect(changes.files).toHaveLength(1)
			expect(changes.baseCheckpoint).toBe(checkpoint1!.commit)

			// Record a new change after restoration
			fileChangeManager.recordChange("test.txt", "edit", checkpoint1!.commit, checkpoint2!.commit, 2, 1)

			// Test restoring to checkpoint3 (after the file's toCheckpoint of checkpoint2)
			await checkpointService.restoreCheckpoint(checkpoint3!.commit)
			await fileChangeManager.updateBaseline(
				checkpoint3!.commit,
				(from, to) => {
					// When baseline is checkpoint3 and file was changed TO checkpoint2,
					// since checkpoint3 > checkpoint2, there should be no diff
					// because checkpoint3 includes all changes up to checkpoint2
					if (from === checkpoint3!.commit && to === checkpoint2!.commit) {
						return Promise.resolve([]) // No diff since we're going backwards
					}
					return checkpointService.getDiff({ from, to })
				},
				{
					baseHash: checkpointService.baseHash,
					_checkpoints: checkpointService.checkpoints,
				},
			)

			// File should be removed since checkpoint3 >= checkpoint2
			// (the new baseline includes the file's changes)
			changes = fileChangeManager.getChanges()
			expect(changes.files).toHaveLength(0)
			expect(changes.baseCheckpoint).toBe(checkpoint3!.commit)
		})
	})
})
