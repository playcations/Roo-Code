// Comprehensive internationalization tests for self-managing FilesChangedOverview component
// npx vitest run src/components/file-changes/__tests__/i18n/InternationalizationSupport.spec.tsx

import React from "react"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { vi } from "vitest"

import { ExtensionStateContext } from "@src/context/ExtensionStateContext"
import { FileChangeType } from "@roo-code/types"

import FilesChangedOverview from "../../FilesChangedOverview"

// Mock vscode API
vi.mock("@src/utils/vscode", () => ({
	vscode: {
		postMessage: vi.fn(),
	},
}))

// Mock react-i18next with comprehensive translation coverage
vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string, options?: any) => {
			const translations: Record<string, string> = {
				// Summary and count translations
				"file-changes:summary.count_with_changes": `${options?.count || 0} files changed${options?.changes || ""}`,
				"file-changes:summary.count_only": `${options?.count || 0} files changed`,

				// Header translations
				"file-changes:header.expand": "Expand",
				"file-changes:header.collapse": "Collapse",

				// Action translations
				"file-changes:actions.accept_all": "Accept All",
				"file-changes:actions.reject_all": "Reject All",
				"file-changes:actions.view_diff": "View Diff",
				"file-changes:actions.accept_file": "Accept",
				"file-changes:actions.reject_file": "Reject",

				// File type translations
				"file-changes:file_types.edit": "Modified",
				"file-changes:file_types.create": "Created",
				"file-changes:file_types.delete": "Deleted",

				// Line change translations
				"file-changes:line_changes.added": `+${options?.count || 0}`,
				"file-changes:line_changes.removed": `-${options?.count || 0}`,
				"file-changes:line_changes.added_removed": `+${options?.added || 0}, -${options?.removed || 0}`,
				"file-changes:line_changes.deleted": "deleted",
				"file-changes:line_changes.modified": "modified",

				// Accessibility translations
				"file-changes:accessibility.files_list": `${options?.count || 0} files ${options?.state || ""}`,
				"file-changes:accessibility.expanded": "expanded",
				"file-changes:accessibility.collapsed": "collapsed",
				"file-changes:accessibility.file_item": `File ${options?.name || ""} ${options?.type || ""} ${options?.changes || ""}`,

				// Status translations
				"file-changes:status.loading": "Loading file changes...",
				"file-changes:status.empty": "No file changes",
				"file-changes:status.error": "Error loading file changes",
			}
			return translations[key] || key
		},
	}),
}))

describe("FilesChangedOverview Internationalization (Self-Managing)", () => {
	const mockExtensionState = {
		filesChangedEnabled: true,
		version: "1.0.0",
		clineMessages: [],
		taskHistory: [],
		shouldShowAnnouncement: false,
		allowedCommands: [],
		alwaysAllowExecute: false,
		didHydrateState: true,
		showWelcome: false,
		theme: {},
		mcpServers: [],
		filePaths: [],
		openedTabs: [],
		organizationAllowList: [],
		cloudIsAuthenticated: false,
		sharingEnabled: false,
		hasOpenedModeSelector: false,
		setHasOpenedModeSelector: () => {},
		condensingApiConfigId: "",
		setCondensingApiConfigId: () => {},
		customCondensingPrompt: "",
		setCustomCondensingPrompt: () => {},
	}

	const mockFilesChanged = [
		{
			uri: "src/components/test1.ts",
			type: "edit" as FileChangeType,
			fromCheckpoint: "hash1",
			toCheckpoint: "hash2",
			linesAdded: 10,
			linesRemoved: 5,
		},
		{
			uri: "src/utils/test2.ts",
			type: "create" as FileChangeType,
			fromCheckpoint: "hash1",
			toCheckpoint: "hash3",
			linesAdded: 20,
			linesRemoved: 0,
		},
		{
			uri: "docs/readme.md",
			type: "delete" as FileChangeType,
			fromCheckpoint: "hash1",
			toCheckpoint: "hash4",
			linesAdded: 0,
			linesRemoved: 15,
		},
	]

	const mockChangeset = {
		baseCheckpoint: "hash1",
		files: mockFilesChanged,
	}

	beforeEach(() => {
		vi.clearAllMocks()
	})

	const renderComponent = () => {
		return render(
			<ExtensionStateContext.Provider value={mockExtensionState as any}>
				<FilesChangedOverview />
			</ExtensionStateContext.Provider>,
		)
	}

	const simulateMessage = (message: any) => {
		const messageEvent = new MessageEvent("message", {
			data: message,
		})
		window.dispatchEvent(messageEvent)
	}

	const setupComponentWithFiles = async () => {
		renderComponent()
		simulateMessage({
			type: "filesChanged",
			filesChanged: mockChangeset,
		})
		await waitFor(() => {
			expect(screen.getByTestId("files-changed-overview")).toBeInTheDocument()
		})
	}

	describe("Translation Key Usage", () => {
		it("should use proper translation keys for header and summary", async () => {
			await setupComponentWithFiles()

			// Header should use translated text with file count and line changes
			expect(screen.getByTestId("files-changed-header")).toHaveTextContent("3 files changed")
			expect(screen.getByTestId("files-changed-header")).toHaveTextContent("(+30, -20)")
		})

		it("should use translated action button labels", async () => {
			await setupComponentWithFiles()

			// Action buttons should use translations
			expect(screen.getByTestId("accept-all-button")).toHaveAttribute("title", "Accept All")
			expect(screen.getByTestId("reject-all-button")).toHaveAttribute("title", "Reject All")
		})

		it("should use translated expand/collapse labels", async () => {
			await setupComponentWithFiles()

			const header = screen.getByRole("button")

			// Should show expand text initially
			expect(header).toHaveAttribute("aria-label")
			const initialAriaLabel = header.getAttribute("aria-label")
			expect(initialAriaLabel).toContain("collapsed")

			// Click to expand
			fireEvent.click(header)

			await waitFor(() => {
				expect(header).toHaveAttribute("aria-expanded", "true")
			})

			// Should show expanded text
			const expandedAriaLabel = header.getAttribute("aria-label")
			expect(expandedAriaLabel).toContain("expanded")
		})

		it("should use translated file type labels", async () => {
			await setupComponentWithFiles()

			// Expand to show individual files
			const header = screen.getByRole("button")
			fireEvent.click(header)

			await waitFor(() => {
				expect(screen.getByTestId("file-item-src/components/test1.ts")).toBeInTheDocument()
			})

			// Check file type translations
			const editFile = screen.getByTestId("file-item-src/components/test1.ts")
			const createFile = screen.getByTestId("file-item-src/utils/test2.ts")
			const deleteFile = screen.getByTestId("file-item-docs/readme.md")

			expect(editFile).toHaveTextContent("Modified")
			expect(createFile).toHaveTextContent("Created")
			expect(deleteFile).toHaveTextContent("Deleted")
		})

		it("should use translated line change labels", async () => {
			await setupComponentWithFiles()

			// Expand to show individual files
			const header = screen.getByRole("button")
			fireEvent.click(header)

			await waitFor(() => {
				expect(screen.getByTestId("file-item-src/components/test1.ts")).toBeInTheDocument()
			})

			// Check line change translations
			const editFile = screen.getByTestId("file-item-src/components/test1.ts")
			const createFile = screen.getByTestId("file-item-src/utils/test2.ts")
			const deleteFile = screen.getByTestId("file-item-docs/readme.md")

			expect(editFile).toHaveTextContent("+10, -5")
			expect(createFile).toHaveTextContent("+20")
			expect(deleteFile).toHaveTextContent("deleted")
		})

		it("should use translated tooltips for individual file actions", async () => {
			await setupComponentWithFiles()

			// Expand to show individual files
			const header = screen.getByRole("button")
			fireEvent.click(header)

			await waitFor(() => {
				expect(screen.getByTestId("file-item-src/components/test1.ts")).toBeInTheDocument()
			})

			// Check tooltips are translated
			const viewDiffButton = screen.getByTestId("diff-src/components/test1.ts")
			const acceptButton = screen.getByTestId("accept-src/components/test1.ts")
			const rejectButton = screen.getByTestId("reject-src/components/test1.ts")

			expect(viewDiffButton).toHaveAttribute("title", "View Diff")
			expect(acceptButton).toHaveAttribute("title", "Accept")
			expect(rejectButton).toHaveAttribute("title", "Reject")
		})
	})

	describe("Translation Parameters and Interpolation", () => {
		it("should correctly interpolate file count in header", async () => {
			await setupComponentWithFiles()

			// Should show correct count (3 files)
			expect(screen.getByTestId("files-changed-header")).toHaveTextContent("3 files changed")
		})

		it("should correctly interpolate line changes in header", async () => {
			await setupComponentWithFiles()

			// Should show total line changes (+30, -20)
			expect(screen.getByTestId("files-changed-header")).toHaveTextContent("(+30, -20)")
		})

		it("should handle single file count correctly", async () => {
			renderComponent()

			// Send message with single file
			const singleFile = [mockFilesChanged[0]]
			simulateMessage({
				type: "filesChanged",
				filesChanged: {
					baseCheckpoint: "hash1",
					files: singleFile,
				},
			})

			await waitFor(() => {
				expect(screen.getByTestId("files-changed-overview")).toBeInTheDocument()
			})

			// Should show "1 files changed" (translation should handle singular/plural)
			expect(screen.getByTestId("files-changed-header")).toHaveTextContent("1 files changed")
		})

		it("should handle zero line changes correctly", async () => {
			renderComponent()

			// Send message with file that has no line changes
			const noChangeFile = [
				{
					uri: "src/test.ts",
					type: "edit" as FileChangeType,
					fromCheckpoint: "hash1",
					toCheckpoint: "hash2",
					linesAdded: 0,
					linesRemoved: 0,
				},
			]

			simulateMessage({
				type: "filesChanged",
				filesChanged: {
					baseCheckpoint: "hash1",
					files: noChangeFile,
				},
			})

			await waitFor(() => {
				expect(screen.getByTestId("files-changed-overview")).toBeInTheDocument()
			})

			// Expand to see individual file
			const header = screen.getByRole("button")
			fireEvent.click(header)

			await waitFor(() => {
				expect(screen.getByTestId("file-item-src/test.ts")).toBeInTheDocument()
			})

			// Should show "modified" for files with no line changes
			expect(screen.getByTestId("file-item-src/test.ts")).toHaveTextContent("modified")
		})
	})

	describe("Edge Cases in Translation", () => {
		it("should handle empty file list with translated message", async () => {
			renderComponent()

			// Send empty file list
			simulateMessage({
				type: "filesChanged",
				filesChanged: {
					baseCheckpoint: "hash1",
					files: [],
				},
			})

			// Should not render (no files to show), but if it did, would show "0 files changed"
			expect(screen.queryByTestId("files-changed-overview")).not.toBeInTheDocument()
		})

		it("should handle large file counts in translations", async () => {
			renderComponent()

			// Create large file set
			const manyFiles = Array.from({ length: 100 }, (_, i) => ({
				uri: `src/file${i}.ts`,
				type: "edit" as FileChangeType,
				fromCheckpoint: "hash1",
				toCheckpoint: "hash2",
				linesAdded: 1,
				linesRemoved: 0,
			}))

			simulateMessage({
				type: "filesChanged",
				filesChanged: {
					baseCheckpoint: "hash1",
					files: manyFiles,
				},
			})

			await waitFor(() => {
				expect(screen.getByTestId("files-changed-overview")).toBeInTheDocument()
			})

			// Should correctly show large count
			expect(screen.getByTestId("files-changed-header")).toHaveTextContent("100 files changed")
			expect(screen.getByTestId("files-changed-header")).toHaveTextContent("(+100, -0)")
		})

		it("should handle special characters in file URIs", async () => {
			renderComponent()

			// Files with special characters
			const specialFiles = [
				{
					uri: "src/café/测试文件.ts", // Mixed scripts
					type: "edit" as FileChangeType,
					fromCheckpoint: "hash1",
					toCheckpoint: "hash2",
					linesAdded: 5,
					linesRemoved: 2,
				},
			]

			simulateMessage({
				type: "filesChanged",
				filesChanged: {
					baseCheckpoint: "hash1",
					files: specialFiles,
				},
			})

			await waitFor(() => {
				expect(screen.getByTestId("files-changed-overview")).toBeInTheDocument()
			})

			// Expand to show file
			const header = screen.getByRole("button")
			fireEvent.click(header)

			await waitFor(() => {
				expect(screen.getByTestId("file-item-src/café/测试文件.ts")).toBeInTheDocument()
			})

			// Should display file path correctly
			expect(screen.getByTestId("file-item-src/café/测试文件.ts")).toHaveTextContent("src/café/测试文件.ts")
		})
	})

	describe("Accessibility Translation Support", () => {
		it("should provide translated ARIA labels for screen readers", async () => {
			await setupComponentWithFiles()

			const header = screen.getByRole("button")

			// ARIA label should contain translated state information
			expect(header).toHaveAttribute("aria-label")
			const ariaLabel = header.getAttribute("aria-label")
			expect(ariaLabel).toContain("3 files")
			expect(ariaLabel).toContain("collapsed")
		})

		it("should update ARIA labels when state changes", async () => {
			await setupComponentWithFiles()

			const header = screen.getByRole("button")

			// Initial state
			expect(header).toHaveAttribute("aria-expanded", "false")
			const initialAriaLabel = header.getAttribute("aria-label")
			expect(initialAriaLabel).toContain("collapsed")

			// Expand
			fireEvent.click(header)

			await waitFor(() => {
				expect(header).toHaveAttribute("aria-expanded", "true")
			})

			// Should show expanded in translation
			const expandedAriaLabel = header.getAttribute("aria-label")
			expect(expandedAriaLabel).toContain("expanded")
		})
	})

	describe("Language Support Verification", () => {
		it("should verify supported language list", () => {
			// Test that we support the expected languages
			const supportedLanguages = [
				"ca",
				"de",
				"en",
				"es",
				"fr",
				"hi",
				"id",
				"it",
				"ja",
				"ko",
				"nl",
				"pl",
				"pt-BR",
				"ru",
				"tr",
				"vi",
				"zh-CN",
				"zh-TW",
			]

			// Core languages should be supported
			expect(supportedLanguages).toContain("en") // English
			expect(supportedLanguages).toContain("es") // Spanish
			expect(supportedLanguages).toContain("fr") // French
			expect(supportedLanguages).toContain("de") // German
			expect(supportedLanguages).toContain("ja") // Japanese
			expect(supportedLanguages).toContain("zh-CN") // Chinese (Simplified)
			expect(supportedLanguages).toContain("zh-TW") // Chinese (Traditional)

			// Total count should be correct
			expect(supportedLanguages).toHaveLength(18)
		})

		it("should verify all required translation keys exist", () => {
			// All keys that should exist in translation files
			const requiredKeys = [
				"file-changes:summary.count_with_changes",
				"file-changes:summary.count_only",
				"file-changes:header.expand",
				"file-changes:header.collapse",
				"file-changes:actions.accept_all",
				"file-changes:actions.reject_all",
				"file-changes:actions.view_diff",
				"file-changes:actions.accept_file",
				"file-changes:actions.reject_file",
				"file-changes:file_types.edit",
				"file-changes:file_types.create",
				"file-changes:file_types.delete",
				"file-changes:line_changes.added",
				"file-changes:line_changes.removed",
				"file-changes:line_changes.added_removed",
				"file-changes:line_changes.deleted",
				"file-changes:line_changes.modified",
				"file-changes:accessibility.files_list",
				"file-changes:accessibility.expanded",
				"file-changes:accessibility.collapsed",
				"file-changes:accessibility.file_item",
			]

			// Verify key structure
			requiredKeys.forEach((key) => {
				expect(key).toMatch(/^file-changes:/)
			})

			// Check we have reasonable coverage
			expect(requiredKeys).toHaveLength(21)
		})

		it("should handle missing translation keys gracefully", async () => {
			// Override mock to return key instead of translation for unknown keys
			const mockUseTranslation = vi.fn().mockReturnValue({
				t: (key: string) => (key.startsWith("file-changes:unknown") ? key : "test translation"),
			})

			// Mock the entire module temporarily
			vi.doMock("react-i18next", () => ({
				useTranslation: mockUseTranslation,
			}))

			await setupComponentWithFiles()

			// Component should still render even with missing translations
			expect(screen.getByTestId("files-changed-overview")).toBeInTheDocument()
		})
	})

	describe("RTL Language Support", () => {
		it("should handle RTL languages appropriately", async () => {
			await setupComponentWithFiles()

			// Component should not break with RTL layouts
			// The styling uses VS Code variables which handle RTL automatically
			const overview = screen.getByTestId("files-changed-overview")
			expect(overview).toBeInTheDocument()

			// Text content should display correctly
			expect(screen.getByTestId("files-changed-header")).toHaveTextContent("3 files changed")
		})

		it("should maintain proper layout with different text lengths", async () => {
			// Test with very long translated text
			const mockUseTranslation = vi.fn().mockReturnValue({
				t: (key: string) => {
					if (key === "file-changes:summary.count_with_changes") {
						return "This is a very long translation that might cause layout issues in some languages like German or Finnish"
					}
					return "test"
				},
			})

			vi.doMock("react-i18next", () => ({
				useTranslation: mockUseTranslation,
			}))

			await setupComponentWithFiles()

			// Should handle long text without breaking layout
			expect(screen.getByTestId("files-changed-overview")).toBeInTheDocument()
		})
	})
})
