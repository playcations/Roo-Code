// Test for FileChangeManager state preservation functionality
// npx vitest run src/services/file-changes/__tests__/FileChangeManager.state-preservation.test.ts

import { describe, beforeEach, it, expect, vi } from "vitest"

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

import { FileChangeManager } from "../FileChangeManager"

describe("FileChangeManager State Preservation", () => {
	let fileChangeManager: FileChangeManager

	beforeEach(() => {
		fileChangeManager = new FileChangeManager("baseHash123", "test-task", "/tmp/test-storage")
	})

	afterEach(() => {
		fileChangeManager?.dispose()
	})

	describe("serializeState", () => {
		it("should serialize the current state correctly", () => {
			// Add some file changes
			fileChangeManager.recordChange("file1.txt", "edit", "baseHash123", "commit1", 5, 2)
			fileChangeManager.recordChange("file2.txt", "create", "baseHash123", "commit2", 10, 0)

			const serializedState = fileChangeManager.serializeState()
			const state = JSON.parse(serializedState)

			expect(state).toHaveProperty("baseCheckpoint", "baseHash123")
			expect(state).toHaveProperty("taskId", "test-task")
			expect(state).toHaveProperty("instanceId")
			expect(state).toHaveProperty("files")
			expect(Array.isArray(state.files)).toBe(true)
			expect(state.files).toHaveLength(2)

			// Check file1.txt
			const file1 = state.files.find((f: any) => f.uri === "file1.txt")
			expect(file1).toBeDefined()
			expect(file1.type).toBe("edit")
			expect(file1.fromCheckpoint).toBe("baseHash123")
			expect(file1.toCheckpoint).toBe("commit1")
			expect(file1.linesAdded).toBe(5)
			expect(file1.linesRemoved).toBe(2)

			// Check file2.txt
			const file2 = state.files.find((f: any) => f.uri === "file2.txt")
			expect(file2).toBeDefined()
			expect(file2.type).toBe("create")
			expect(file2.fromCheckpoint).toBe("baseHash123")
			expect(file2.toCheckpoint).toBe("commit2")
			expect(file2.linesAdded).toBe(10)
			expect(file2.linesRemoved).toBe(0)
		})

		it("should serialize empty state correctly", () => {
			const serializedState = fileChangeManager.serializeState()
			const state = JSON.parse(serializedState)

			expect(state).toHaveProperty("baseCheckpoint", "baseHash123")
			expect(state).toHaveProperty("taskId", "test-task")
			expect(state).toHaveProperty("instanceId")
			expect(state).toHaveProperty("files")
			expect(Array.isArray(state.files)).toBe(true)
			expect(state.files).toHaveLength(0)
		})
	})

	describe("restoreState", () => {
		it("should restore state correctly", () => {
			// Create initial state with some changes
			fileChangeManager.recordChange("file1.txt", "edit", "baseHash123", "commit1", 5, 2)
			fileChangeManager.recordChange("file2.txt", "create", "baseHash123", "commit2", 10, 0)

			// Serialize the state
			const serializedState = fileChangeManager.serializeState()

			// Create new manager and restore state
			const newManager = new FileChangeManager("newBaseHash", "new-task", "/tmp/new-storage")
			newManager.restoreState(serializedState)

			// Verify state was restored correctly
			const restoredChanges = newManager.getChanges()
			expect(restoredChanges.baseCheckpoint).toBe("baseHash123") // Should use restored baseline
			expect(restoredChanges.files).toHaveLength(2)

			const file1 = restoredChanges.files.find((f) => f.uri === "file1.txt")
			expect(file1).toBeDefined()
			expect(file1!.type).toBe("edit")
			expect(file1!.fromCheckpoint).toBe("baseHash123")
			expect(file1!.toCheckpoint).toBe("commit1")
			expect(file1!.linesAdded).toBe(5)
			expect(file1!.linesRemoved).toBe(2)

			const file2 = restoredChanges.files.find((f) => f.uri === "file2.txt")
			expect(file2).toBeDefined()
			expect(file2!.type).toBe("create")
			expect(file2!.fromCheckpoint).toBe("baseHash123")
			expect(file2!.toCheckpoint).toBe("commit2")
			expect(file2!.linesAdded).toBe(10)
			expect(file2!.linesRemoved).toBe(0)

			newManager.dispose()
		})

		it("should handle invalid serialized state gracefully", () => {
			const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {})

			// Try to restore invalid JSON
			fileChangeManager.restoreState("invalid json")

			// Should not throw and manager should remain functional
			expect(consoleSpy).toHaveBeenCalledWith(
				"Failed to restore FileChangeManager state:",
				expect.any(SyntaxError),
			)

			// Manager should still work
			fileChangeManager.recordChange("file1.txt", "edit", "baseHash123", "commit1", 1, 0)
			const changes = fileChangeManager.getChanges()
			expect(changes.files).toHaveLength(1)

			consoleSpy.mockRestore()
		})

		it("should handle state with missing properties gracefully", () => {
			const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {})

			// Try to restore state missing files property
			const incompleteState = JSON.stringify({
				baseCheckpoint: "newBase",
				taskId: "new-task",
				instanceId: "instance-123",
				// Missing files property
			})

			fileChangeManager.restoreState(incompleteState)

			// Should restore what it can
			const changes = fileChangeManager.getChanges()
			expect(changes.baseCheckpoint).toBe("newBase")
			expect(changes.files).toHaveLength(0) // Should have empty files

			consoleSpy.mockRestore()
		})
	})

	describe("state preservation integration", () => {
		it("should preserve and restore state correctly through serialize/restore cycle", () => {
			// Create original state
			fileChangeManager.recordChange("src/main.ts", "edit", "hash1", "hash2", 15, 3)
			fileChangeManager.recordChange("README.md", "edit", "hash1", "hash3", 2, 1)
			fileChangeManager.recordChange("package.json", "create", "hash1", "hash4", 20, 0)

			const originalChanges = fileChangeManager.getChanges()
			expect(originalChanges.files).toHaveLength(3)

			// Serialize state
			const serializedState = fileChangeManager.serializeState()

			// Create new manager with different initial state
			const newManager = new FileChangeManager("differentBase", "different-task", "/tmp/different")

			// Add some different changes to the new manager
			newManager.recordChange("temp.txt", "create", "differentBase", "tempCommit", 1, 0)
			expect(newManager.getChanges().files).toHaveLength(1)

			// Restore the serialized state (should overwrite current state)
			newManager.restoreState(serializedState)

			// Verify the state was completely restored
			const restoredChanges = newManager.getChanges()
			expect(restoredChanges.baseCheckpoint).toBe(originalChanges.baseCheckpoint)
			expect(restoredChanges.files).toHaveLength(3) // Should have original 3, not the temp one

			// Verify each file was restored correctly
			const mainFile = restoredChanges.files.find((f) => f.uri === "src/main.ts")
			expect(mainFile).toBeDefined()
			expect(mainFile!.linesAdded).toBe(15)
			expect(mainFile!.linesRemoved).toBe(3)

			const readmeFile = restoredChanges.files.find((f) => f.uri === "README.md")
			expect(readmeFile).toBeDefined()
			expect(readmeFile!.toCheckpoint).toBe("hash3")

			const packageFile = restoredChanges.files.find((f) => f.uri === "package.json")
			expect(packageFile).toBeDefined()
			expect(packageFile!.type).toBe("create")

			// Should NOT have the temp file
			const tempFile = restoredChanges.files.find((f) => f.uri === "temp.txt")
			expect(tempFile).toBeUndefined()

			newManager.dispose()
		})
	})
})
