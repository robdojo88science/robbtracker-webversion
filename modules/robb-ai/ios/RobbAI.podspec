require 'json'
package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

Pod::Spec.new do |s|
  s.name = 'RobbAI'
  s.version = package['version']
  s.summary = package['description']
  s.description = package['description']
  s.license = package['license']
  s.author = package['author']
  s.homepage = 'https://github.com/robdojo88science/ftracker'
  s.platforms = { :ios => '16.4' }
  s.swift_version = '5.9'
  s.source = { :git => 'https://github.com/robdojo88science/ftracker.git' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = '**/*.swift'
  # Keep older SDK builds functional; only SDK 26+ contains FoundationModels.
  sdk_version = `xcrun --sdk iphoneos --show-sdk-version 2>/dev/null`.strip.to_f
  s.weak_frameworks = 'FoundationModels' if sdk_version >= 26
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
end
