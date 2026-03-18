using TestProject.Services;

namespace TestProject
{
    public class Program
    {
        public static void Main(string[] args)
        {
            var builder = WebApplication.CreateBuilder(args);

            // Register services
            builder.Services.AddControllers();
            builder.Services.AddSingleton<IFileSystemService, FileSystemService>();

            var app = builder.Build();

            // Serve static files from wwwroot (our SPA lives here)
            app.UseDefaultFiles();
            app.UseStaticFiles();

            app.MapControllers();

            // Validate the configured home directory on startup
            var fileService = app.Services.GetRequiredService<IFileSystemService>();
            var homeDir = builder.Configuration["FileServer:HomeDirectory"] ?? "FilesDirectory";
            if (!Directory.Exists(homeDir))
            {
                Console.WriteLine($"WARNING: Home directory '{homeDir}' does not exist. Creating it...");
                Directory.CreateDirectory(homeDir);
            }
            Console.WriteLine($"File Browser Home Directory: {homeDir}");

            app.Run();
        }
    }
}
