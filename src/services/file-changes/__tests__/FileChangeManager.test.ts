// Tests for simplified FileChangeManager - Pure diff calculation service
// npx vitest run src/services/file-changes/__tests__/FileChangeManager.simplified.test.ts

import { describe, beforeEach, it, expect } from "vitest"
import { FileChangeManager } from "../FileChangeManager"
import { FileChange } from "@roo-code/types"

describe("FileChangeManager (Simplified)", () => {
	let fileChangeManager: FileChangeManager

	beforeEach(() => {
		fileChangeManager = new FileChangeManager("initial-checkpoint")
	})

	afterEach(() => {
		fileChangeManager.dispose()
	})

	describe("Constructor", () => {
		it("should create manager with baseline checkpoint", () => {
			const manager = new FileChangeManager("test-checkpoint")
			const changes = manager.getChanges()

			expect(changes.baseCheckpoint).toBe("test-checkpoint")
			expect(changes.files).toEqual([])
		})
	})

	describe("getChanges", () => {
		it("should return empty changeset initially", () => {
			const changes = fileChangeManager.getChanges()

			expect(changes.baseCheckpoint).toBe("initial-checkpoint")
			expect(changes.files).toEqual([])
		})

		it("should filter out accepted files", () => {
			// Setup some files
			const testFiles: FileChange[] = [
				{
					uri: "file1.txt",
					type: "edit",
					fromCheckpoint: "initial-checkpoint",
					toCheckpoint: "current",
					linesAdded: 5,
					linesRemoved: 2,
				},
				{
					uri: "file2.txt",
					type: "create",
					fromCheckpoint: "initial-checkpoint",
					toCheckpoint: "current",
					linesAdded: 10,
					linesRemoved: 0,
				},
			]

			fileChangeManager.setFiles(testFiles)

			// Accept one file
			fileChangeManager.acceptChange("file1.txt")

			const changes = fileChangeManager.getChanges()
			expect(changes.files).toHaveLength(1)
			expect(changes.files[0].uri).toBe("file2.txt")
		})

		it("should filter out rejected files", () => {
			const testFiles: FileChange[] = [
				{
					uri: "file1.txt",
					type: "edit",
					fromCheckpoint: "initial-checkpoint",
					toCheckpoint: "current",
					linesAdded: 5,
					linesRemoved: 2,
				},
				{
					uri: "file2.txt",
					type: "create",
					fromCheckpoint: "initial-checkpoint",
					toCheckpoint: "current",
					linesAdded: 10,
					linesRemoved: 0,
				},
			]

			fileChangeManager.setFiles(testFiles)

			// Reject one file
			fileChangeManager.rejectChange("file1.txt")

			const changes = fileChangeManager.getChanges()
			expect(changes.files).toHaveLength(1)
			expect(changes.files[0].uri).toBe("file2.txt")
		})
	})

	describe("getFileChange", () => {
		it("should return specific file change", () => {
			const testFile: FileChange = {
				uri: "test.txt",
				type: "edit",
				fromCheckpoint: "initial-checkpoint",
				toCheckpoint: "current",
				linesAdded: 3,
				linesRemoved: 1,
			}

			fileChangeManager.setFiles([testFile])

			const result = fileChangeManager.getFileChange("test.txt")
			expect(result).toEqual(testFile)
		})

		it("should return undefined for non-existent file", () => {
			const result = fileChangeManager.getFileChange("non-existent.txt")
			expect(result).toBeUndefined()
		})
	})

	describe("acceptChange", () => {
		it("should mark file as accepted", async () => {
			const testFile: FileChange = {
				uri: "test.txt",
				type: "edit",
				fromCheckpoint: "initial-checkpoint",
				toCheckpoint: "current",
				linesAdded: 3,
				linesRemoved: 1,
			}

			fileChangeManager.setFiles([testFile])

			await fileChangeManager.acceptChange("test.txt")

			const changes = fileChangeManager.getChanges()
			expect(changes.files).toHaveLength(0) // File filtered out
		})

		it("should remove from rejected if previously rejected", async () => {
			const testFile: FileChange = {
				uri: "test.txt",
				type: "edit",
				fromCheckpoint: "initial-checkpoint",
				toCheckpoint: "current",
				linesAdded: 3,
				linesRemoved: 1,
			}

			fileChangeManager.setFiles([testFile])

			// First reject, then accept
			await fileChangeManager.rejectChange("test.txt")
			await fileChangeManager.acceptChange("test.txt")

			const changes = fileChangeManager.getChanges()
			expect(changes.files).toHaveLength(0) // File filtered out as accepted
		})
	})

	describe("rejectChange", () => {
		it("should mark file as rejected", async () => {
			const testFile: FileChange = {
				uri: "test.txt",
				type: "edit",
				fromCheckpoint: "initial-checkpoint",
				toCheckpoint: "current",
				linesAdded: 3,
				linesRemoved: 1,
			}

			fileChangeManager.setFiles([testFile])

			await fileChangeManager.rejectChange("test.txt")

			const changes = fileChangeManager.getChanges()
			expect(changes.files).toHaveLength(0) // File filtered out
		})
	})

	describe("acceptAll", () => {
		it("should accept all files", async () => {
			const testFiles: FileChange[] = [
				{
					uri: "file1.txt",
					type: "edit",
					fromCheckpoint: "initial-checkpoint",
					toCheckpoint: "current",
					linesAdded: 5,
					linesRemoved: 2,
				},
				{
					uri: "file2.txt",
					type: "create",
					fromCheckpoint: "initial-checkpoint",
					toCheckpoint: "current",
					linesAdded: 10,
					linesRemoved: 0,
				},
			]

			fileChangeManager.setFiles(testFiles)

			await fileChangeManager.acceptAll()

			const changes = fileChangeManager.getChanges()
			expect(changes.files).toHaveLength(0) // All files filtered out
		})
	})

	describe("rejectAll", () => {
		it("should reject all files", async () => {
			const testFiles: FileChange[] = [
				{
					uri: "file1.txt",
					type: "edit",
					fromCheckpoint: "initial-checkpoint",
					toCheckpoint: "current",
					linesAdded: 5,
					linesRemoved: 2,
				},
				{
					uri: "file2.txt",
					type: "create",
					fromCheckpoint: "initial-checkpoint",
					toCheckpoint: "current",
					linesAdded: 10,
					linesRemoved: 0,
				},
			]

			fileChangeManager.setFiles(testFiles)

			await fileChangeManager.rejectAll()

			const changes = fileChangeManager.getChanges()
			expect(changes.files).toHaveLength(0) // All files filtered out
		})
	})

	describe("updateBaseline", () => {
		it("should update baseline checkpoint", async () => {
			await fileChangeManager.updateBaseline("new-baseline")

			const changes = fileChangeManager.getChanges()
			expect(changes.baseCheckpoint).toBe("new-baseline")
		})

		it("should clear files and reset state on baseline update", async () => {
			const testFile: FileChange = {
				uri: "test.txt",
				type: "edit",
				fromCheckpoint: "initial-checkpoint",
				toCheckpoint: "current",
				linesAdded: 3,
				linesRemoved: 1,
			}

			fileChangeManager.setFiles([testFile])
			await fileChangeManager.acceptChange("test.txt")

			// Update baseline should clear everything
			await fileChangeManager.updateBaseline("new-baseline")

			// Add the same file again
			fileChangeManager.setFiles([testFile])

			// File should appear again (accepted state cleared)
			const changes = fileChangeManager.getChanges()
			expect(changes.files).toHaveLength(1)
		})
	})

	describe("setFiles", () => {
		it("should set the files in changeset", () => {
			const testFiles: FileChange[] = [
				{
					uri: "file1.txt",
					type: "edit",
					fromCheckpoint: "initial-checkpoint",
					toCheckpoint: "current",
					linesAdded: 5,
					linesRemoved: 2,
				},
			]

			fileChangeManager.setFiles(testFiles)

			const changes = fileChangeManager.getChanges()
			expect(changes.files).toEqual(testFiles)
		})
	})

	describe("calculateLineDifferences", () => {
		it("should calculate lines added", () => {
			const original = "line1\nline2"
			const modified = "line1\nline2\nline3\nline4"

			const result = FileChangeManager.calculateLineDifferences(original, modified)

			expect(result.linesAdded).toBe(2)
			expect(result.linesRemoved).toBe(0)
		})

		it("should calculate lines removed", () => {
			const original = "line1\nline2\nline3\nline4"
			const modified = "line1\nline2"

			const result = FileChangeManager.calculateLineDifferences(original, modified)

			expect(result.linesAdded).toBe(0)
			expect(result.linesRemoved).toBe(2)
		})

		it("should handle equal length changes", () => {
			const original = "line1\nline2"
			const modified = "line1\nline2"

			const result = FileChangeManager.calculateLineDifferences(original, modified)

			expect(result.linesAdded).toBe(0)
			expect(result.linesRemoved).toBe(0)
		})
	})
})
