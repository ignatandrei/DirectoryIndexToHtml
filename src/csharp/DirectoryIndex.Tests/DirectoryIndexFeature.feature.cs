using DirectoryIndex.Core;
using Mirality.FileProviders.InMemory;

namespace DirectoryIndex.Tests;

public partial class DirectoryIndexFeature
{
    private Task Given_a_root_with_a_nested_directory_and_files()
    {
        _provider = new TestFileProvider()
            .AddDirectory("alpha child")
            .AddFile("alpha child/a file.txt")
            .AddFile("root file.txt");
        _output = new RecordingOutputWriter();
        _template = "{{ directory.name }}|{{ directory.path }}|{{ for e in entries }}{{ e.name }}:{{ e.path }}:{{ e.is_directory }}:{{ e.href }};{{ end }}|{{ for b in breadcrumbs }}{{ b.name }}:{{ b.href }}:{{ b.is_current }};{{ end }}";
        return Task.CompletedTask;
    }

    private async Task When_pages_are_rendered_with_listing_metadata()
    {
        await CreateGenerator().GenerateAsync("unused", "root");
    }

    private Task Then_entries_and_breadcrumbs_have_relative_links()
    {
        Assert.Equal(2, _output!.Pages.Count);
        Assert.Equal(
            "root||alpha child:alpha child:true:alpha%20child/index.html;root file.txt:root file.txt:false:root%20file.txt;|root:index.html:true;",
            _output.Pages["index.html"]);
        Assert.Equal(
            "alpha child|alpha child|a file.txt:alpha child/a file.txt:false:a%20file.txt;|root:../index.html:false;alpha child:index.html:true;",
            _output.Pages["alpha child/index.html"]);
        return Task.CompletedTask;
    }

    private Task Given_the_proposed_in_memory_file_provider_with_a_nested_file()
    {
        var provider = new InMemoryFileProvider();
        provider["nested/file.txt"] = new InMemoryFileInfo("file.txt", "content");
        _provider = provider;
        _output = new RecordingOutputWriter();
        _template = "{{ directory.path }}:{{ for e in entries }}{{ e.name }};{{ end }}";
        return Task.CompletedTask;
    }

    private async Task When_the_index_pages_are_generated()
    {
        await CreateGenerator().GenerateAsync("unused", "root");
    }

    private Task Then_root_and_nested_contents_are_available()
    {
        Assert.Equal(":nested;", _output!.Pages["index.html"]);
        Assert.Equal("nested:file.txt;", _output.Pages["nested/index.html"]);
        return Task.CompletedTask;
    }

    private Task Given_hidden_generated_index_and_template_entries()
    {
        _provider = new TestFileProvider()
            .AddFile(".hidden")
            .AddFile("index.html", "old")
            .AddFile("template.sbn")
            .AddFile("visible.txt");
        _output = new RecordingOutputWriter();
        _template = "{{ for e in entries }}{{ e.name }};{{ end }}";
        _excludedTemplatePath = "template.sbn";
        return Task.CompletedTask;
    }

    private async Task When_the_listing_is_rendered()
    {
        await CreateGenerator().GenerateAsync("unused", "root");
    }

    private Task Then_only_listable_entries_are_exposed()
    {
        Assert.Equal(".hidden;visible.txt;", _output!.Pages["index.html"]);
        return Task.CompletedTask;
    }

    private Task Given_directories_and_files_in_mixed_order()
    {
        _provider = new TestFileProvider()
            .AddFile("zeta.txt")
            .AddFile("alpha.txt")
            .AddDirectory("zeta")
            .AddDirectory("Beta")
            .AddDirectory("alpha");
        _output = new RecordingOutputWriter();
        _template = DirectoryIndexTemplates.Default;
        return Task.CompletedTask;
    }

    private async Task When_default_pages_are_generated_for_populated_and_empty_directories()
    {
        await CreateGenerator().GenerateAsync("unused", "root");

        var emptyOutput = new RecordingOutputWriter();
        await new DirectoryIndexGenerator(
            new TestFileProvider(),
            emptyOutput,
            DirectoryIndexTemplates.Default,
            "default template").GenerateAsync("unused", "root");
        _html = _output!.Pages["index.html"];
        _emptyHtml = emptyOutput.Pages["index.html"];
    }

    private Task Then_default_output_is_sorted_and_has_an_empty_state()
    {
        Assert.Contains("No files or folders", _emptyHtml);
        Assert.True(_html!.IndexOf("alpha/index.html", StringComparison.Ordinal) < _html.IndexOf("Beta/index.html", StringComparison.Ordinal));
        Assert.True(_html.IndexOf("Beta/index.html", StringComparison.Ordinal) < _html.IndexOf("zeta/index.html", StringComparison.Ordinal));
        Assert.True(_html.IndexOf("zeta/index.html", StringComparison.Ordinal) < _html.IndexOf("alpha.txt", StringComparison.Ordinal));
        Assert.Contains("<span aria-current=\"page\">root</span>", _html);
        return Task.CompletedTask;
    }

    private Task Given_an_invalid_scriban_template()
    {
        _provider = new TestFileProvider();
        _output = new RecordingOutputWriter();
        _template = "{{ if }}";
        return Task.CompletedTask;
    }

    private Task When_the_generator_is_created()
    {
        try
        {
            _ = CreateGenerator();
        }
        catch (Exception exception)
        {
            _operationError = exception;
        }

        return Task.CompletedTask;
    }

    private Task Then_template_parsing_fails_before_output()
    {
        Assert.IsType<FormatException>(_operationError);
        Assert.False(_output!.Called);
        return Task.CompletedTask;
    }

    private Task Given_a_template_that_fails_during_rendering()
    {
        _provider = new TestFileProvider();
        _output = new RecordingOutputWriter();
        _template = "{{ throw \"render failure\" }}";
        return Task.CompletedTask;
    }

    private async Task When_the_directory_is_rendered()
    {
        try
        {
            await CreateGenerator().GenerateAsync("unused", "root");
        }
        catch (Exception exception)
        {
            _operationError = exception;
        }
    }

    private Task Then_output_writing_is_not_started()
    {
        Assert.NotNull(_operationError);
        Assert.False(_output!.Called);
        return Task.CompletedTask;
    }

    private Task Given_existing_index_and_a_blocked_commit_target()
    {
        _root = CreateTemporaryDirectory();
        Directory.CreateDirectory(Path.Combine(_root, "blocked", "index.html"));
        Directory.CreateDirectory(Path.Combine(_root, "new"));
        File.WriteAllText(Path.Combine(_root, "index.html"), "original root");
        return Task.CompletedTask;
    }

    private async Task When_the_staged_pages_are_committed()
    {
        try
        {
            await new TransactionalFileOutputWriter().WriteAllAsync(_root!, new Dictionary<string, string>
            {
                ["index.html"] = "new root",
                ["new/index.html"] = "new page",
                ["blocked/index.html"] = "blocked page"
            });
        }
        catch (Exception exception)
        {
            _operationError = exception;
        }
    }

    private async Task Then_the_original_index_is_restored_and_new_indexes_are_removed()
    {
        Assert.NotNull(_operationError);
        Assert.Equal("original root", await File.ReadAllTextAsync(Path.Combine(_root!, "index.html")));
        Assert.False(File.Exists(Path.Combine(_root!, "new", "index.html")));
    }

    private Task Given_a_commit_and_restore_failure()
    {
        _root = CreateTemporaryDirectory();
        Directory.CreateDirectory(Path.Combine(_root, "blocked", "index.html"));
        File.WriteAllText(Path.Combine(_root, "index.html"), "original root");
        return Task.CompletedTask;
    }

    private async Task When_transactional_output_is_written()
    {
        try
        {
            var writer = new TransactionalFileOutputWriter(new FailingRollbackFileSystem());
            await writer.WriteAllAsync(_root!, new Dictionary<string, string>
            {
                ["index.html"] = "new root",
                ["blocked/index.html"] = "blocked"
            });
        }
        catch (Exception exception)
        {
            _operationError = exception;
        }
    }

    private Task Then_the_commit_and_rollback_errors_are_reported()
    {
        var exception = Assert.IsType<AggregateException>(_operationError);
        Assert.Contains(exception.InnerExceptions, item => item.Message.Contains("commit failed", StringComparison.Ordinal));
        Assert.Contains(exception.InnerExceptions, item => item.Message.Contains("roll back", StringComparison.Ordinal));
        return Task.CompletedTask;
    }

    private async Task Given_a_directory_link_to_an_external_folder()
    {
        _root = CreateTemporaryDirectory();
        _outside = CreateTemporaryDirectory();
        await File.WriteAllTextAsync(Path.Combine(_outside, "secret.txt"), "secret");
        try
        {
            Directory.CreateSymbolicLink(Path.Combine(_root, "linked"), _outside);
        }
        catch (Exception exception) when (exception is UnauthorizedAccessException or IOException or PlatformNotSupportedException)
        {
            _operationError = exception;
        }
    }

    private async Task When_the_physical_directory_is_indexed()
    {
        using var provider = new PhysicalFileProviderAdapter(_root!);
        _output = new RecordingOutputWriter();
        await new DirectoryIndexGenerator(
            provider,
            _output,
            "{{ for e in entries }}{{ e.name }};{{ end }}",
            "test template").GenerateAsync(_root!, "root");
    }

    private Task Then_the_linked_directory_is_not_listed_or_traversed()
    {
        Assert.DoesNotContain("linked", _output!.Pages["index.html"]);
        Assert.DoesNotContain("linked/index.html", _output.Pages.Keys);
        return Task.CompletedTask;
    }

    private Task Given_a_temporary_folder_for_the_cli()
    {
        _root = CreateTemporaryDirectory();
        return Task.CompletedTask;
    }

    private async Task When_the_cli_is_run_with_valid_and_missing_arguments()
    {
        using var stdout = new StringWriter();
        using var stderr = new StringWriter();
        _validExitCode = await DirectoryIndex.Cli.Program.RunAsync(["--folder", _root!], stdout, stderr);
        _standardOutput = stdout.ToString();

        using var invalidStdout = new StringWriter();
        using var invalidStderr = new StringWriter();
        _invalidExitCode = await DirectoryIndex.Cli.Program.RunAsync([], invalidStdout, invalidStderr);
        _standardError = invalidStderr.ToString();
    }

    private Task Then_the_cli_generates_an_index_and_reports_invalid_arguments()
    {
        Assert.Equal(0, _validExitCode);
        Assert.True(File.Exists(Path.Combine(_root!, "index.html")));
        Assert.Contains("Generated indexes", _standardOutput);
        Assert.NotEqual(0, _invalidExitCode);
        Assert.NotEmpty(_standardError ?? string.Empty);
        return Task.CompletedTask;
    }
}
