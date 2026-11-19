using DirectoryIndex.Core;
using LightBDD.Framework;
using LightBDD.Framework.Scenarios;
using LightBDD.XUnit2;
using Microsoft.Extensions.FileProviders;

namespace DirectoryIndex.Tests;

[FeatureDescription("Generate transactional directory indexes with built-in and custom templates")]
public partial class DirectoryIndexFeature : FeatureFixture
{
    private IFileProvider? _provider;
    private RecordingOutputWriter? _output;
    private string? _template;
    private string? _excludedTemplatePath;
    private string? _root;
    private string? _outside;
    private string? _html;
    private string? _emptyHtml;
    private string? _standardOutput;
    private string? _standardError;
    private Exception? _operationError;
    private int _validExitCode;
    private int _invalidExitCode;

    [Scenario]
    public async Task Generates_root_and_nested_pages_with_metadata_links_and_breadcrumbs()
    {
        await Runner.RunScenarioAsync(
            Given_a_root_with_a_nested_directory_and_files,
            When_pages_are_rendered_with_listing_metadata,
            Then_entries_and_breadcrumbs_have_relative_links);
    }

    [Scenario]
    public async Task Proposed_in_memory_provider_enumerates_nested_directory_contents()
    {
        await Runner.RunScenarioAsync(
            Given_the_proposed_in_memory_file_provider_with_a_nested_file,
            When_the_index_pages_are_generated,
            Then_root_and_nested_contents_are_available);
    }

    [Scenario]
    public async Task Excludes_hidden_generated_index_and_template_file()
    {
        await Runner.RunScenarioAsync(
            Given_hidden_generated_index_and_template_entries,
            When_the_listing_is_rendered,
            Then_only_listable_entries_are_exposed);
    }

    [Scenario]
    public async Task Renders_listings_with_more_than_1000_entries()
    {
        await Runner.RunScenarioAsync(
            Given_more_than_1000_files,
            When_the_index_pages_are_generated,
            Then_all_1001_entries_are_rendered);
    }

    [Scenario]
    public async Task Default_template_renders_empty_state_and_sorted_directories_before_files()
    {
        await Runner.RunScenarioAsync(
            Given_directories_and_files_in_mixed_order,
            When_default_pages_are_generated_for_populated_and_empty_directories,
            Then_default_output_is_sorted_and_has_an_empty_state);
    }

    [Scenario]
    public async Task Invalid_template_fails_before_generation()
    {
        await Runner.RunScenarioAsync(
            Given_an_invalid_scriban_template,
            When_the_generator_is_created,
            Then_template_parsing_fails_before_output);
    }

    [Scenario]
    public async Task Template_rendering_failure_does_not_call_output_writer()
    {
        await Runner.RunScenarioAsync(
            Given_a_template_that_fails_during_rendering,
            When_the_directory_is_rendered,
            Then_output_writing_is_not_started);
    }

    [Scenario]
    public async Task Commit_failure_restores_overwritten_files_and_removes_new_indexes()
    {
        await RunWithTemporaryDirectoryCleanup(() => Runner.RunScenarioAsync(
            Given_existing_index_and_a_blocked_commit_target,
            When_the_staged_pages_are_committed,
            Then_the_original_index_is_restored_and_new_indexes_are_removed));
    }

    [Scenario]
    public async Task Rollback_failures_are_reported()
    {
        await RunWithTemporaryDirectoryCleanup(() => Runner.RunScenarioAsync(
            Given_a_commit_and_restore_failure,
            When_transactional_output_is_written,
            Then_the_commit_and_rollback_errors_are_reported));
    }

    [Scenario]
    public async Task Physical_adapter_skips_reparse_point_directories()
    {
        await RunWithTemporaryDirectoryCleanup(() => Runner.RunScenarioAsync(
            Given_a_directory_link_to_an_external_folder,
            When_the_physical_directory_is_indexed,
            Then_the_linked_directory_is_not_listed_or_traversed));
    }

    [Scenario]
    public async Task Physical_adapter_includes_hidden_dot_prefixed_and_system_files()
    {
        await RunWithTemporaryDirectoryCleanup(() => Runner.RunScenarioAsync(
            Given_physical_hidden_dot_prefixed_and_system_files,
            When_the_physical_directory_is_indexed,
            Then_all_physical_files_are_listed));
    }

    [Scenario]
    public async Task Cli_handles_valid_folder_and_rejects_missing_folder_argument()
    {
        await RunWithTemporaryDirectoryCleanup(() => Runner.RunScenarioAsync(
            Given_a_temporary_folder_for_the_cli,
            When_the_cli_is_run_with_valid_and_missing_arguments,
            Then_the_cli_generates_an_index_and_reports_invalid_arguments));
    }

    private DirectoryIndexGenerator CreateGenerator() =>
        new(_provider!, _output!, _template!, "test template", _excludedTemplatePath);

    private async Task RunWithTemporaryDirectoryCleanup(Func<Task> scenario)
    {
        try
        {
            await scenario();
        }
        finally
        {
            if (_root is not null && Directory.Exists(_root))
            {
                Directory.Delete(_root, recursive: true);
            }

            if (_outside is not null && Directory.Exists(_outside))
            {
                Directory.Delete(_outside, recursive: true);
            }
        }
    }

    private static string CreateTemporaryDirectory()
    {
        var path = Path.Combine(Path.GetTempPath(), $"directory-index-test-{Guid.NewGuid():N}");
        Directory.CreateDirectory(path);
        return path;
    }

    private sealed class FailingRollbackFileSystem : TransactionalFileOutputWriter.IOutputFileSystem
    {
        private readonly TransactionalFileOutputWriter.PhysicalOutputFileSystem _inner = new();

        public bool FileExists(string path) => _inner.FileExists(path);
        public bool DirectoryExists(string path) => _inner.DirectoryExists(path);
        public void CreateDirectory(string path) => _inner.CreateDirectory(path);
        public Task WriteAllTextAsync(string path, string content, CancellationToken cancellationToken) =>
            _inner.WriteAllTextAsync(path, content, cancellationToken);
        public void DeleteFile(string path) => _inner.DeleteFile(path);
        public void DeleteDirectory(string path, bool recursive) => _inner.DeleteDirectory(path, recursive);

        public void CopyFile(string source, string destination, bool overwrite)
        {
            if (source.Contains(Path.Combine("staged", "blocked", "index.html"), StringComparison.OrdinalIgnoreCase))
            {
                throw new IOException("commit failed");
            }

            if (source.Contains(Path.Combine("backups", "index.html"), StringComparison.OrdinalIgnoreCase))
            {
                throw new IOException("restore failed");
            }

            _inner.CopyFile(source, destination, overwrite);
        }
    }
}
